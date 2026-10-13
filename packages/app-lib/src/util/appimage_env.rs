//! Undo AppImage environment injection before spawning a child process.
//!
//! AppImages built with the linuxdeploy GTK hook (`AppRun` sources
//! `apprun-hooks/linuxdeploy-plugin-gtk.sh`) and the AppImageKit runtime export
//! mount-relative paths into the environment: `APPDIR`, `LD_LIBRARY_PATH`,
//! `PATH`, `GTK_*`, `GIO_*`, `GI_TYPELIB_PATH`, `XDG_DATA_DIRS`, and so on.
//! Children that inherit them resolve libraries, GTK modules and helper
//! binaries from the (shortly unmounted) `/tmp/.mount_*` directory instead of
//! the host:
//!
//! * the game JVM loads the AppImage's `libwayland-client` and segfaults in the
//!   render thread (issue #171/B6),
//! * `xdg-open` resolves to the AppImage's bundled copy, so the desktop opener
//!   never launches a browser (B7, not fixed by #170),
//! * the folder opener inherits the same broken loader path (B4).
//!
//! [`appimage_env_overrides`] computes the correction once and the two
//! `scrub_*` functions apply it to the `Command` types the workspace spawns
//! with. Restoring the `OLD_*` counterpart (the #170 strategy) is preferred;
//! when there is none, mount entries are stripped from path-list variables and
//! the variable is dropped if nothing host-side remains.

use std::ffi::{OsStr, OsString};

/// `(child variable, OLD_* fallback)` pairs the AppImage runtime and the
/// linuxdeploy GTK hook write into the environment.
const APPIMAGE_ENV_VARS: &[(&str, &str)] = &[
    ("LD_LIBRARY_PATH", "OLD_LD_LIBRARY_PATH"),
    ("LD_PRELOAD", "OLD_LD_PRELOAD"),
    ("PATH", "OLD_PATH"),
    ("XDG_DATA_DIRS", "OLD_XDG_DATA_DIRS"),
    ("GTK_PATH", "OLD_GTK_PATH"),
    ("GTK_EXE_PREFIX", "OLD_GTK_EXE_PREFIX"),
    ("GTK_DATA_PREFIX", "OLD_GTK_DATA_PREFIX"),
    ("GTK_IM_MODULE_FILE", "OLD_GTK_IM_MODULE_FILE"),
    ("GDK_PIXBUF_MODULE_FILE", "OLD_GDK_PIXBUF_MODULE_FILE"),
    ("GIO_MODULE_DIR", "OLD_GIO_MODULE_DIR"),
    ("GIO_EXTRA_MODULES", "OLD_GIO_EXTRA_MODULES"),
    ("GI_TYPELIB_PATH", "OLD_GI_TYPELIB_PATH"),
    ("GSETTINGS_SCHEMA_DIR", "OLD_GSETTINGS_SCHEMA_DIR"),
];

/// Variables that only point at the mount and have no host fallback.
const APPIMAGE_MARKER_VARS: &[&str] = &["APPIMAGE", "APPDIR", "ARGV0", "OWD"];

/// True when a single `:`-separated entry points into the AppImage mount.
fn entry_under_mount(entry: &str, appdir: Option<&str>) -> bool {
    if entry.is_empty() {
        return false;
    }
    if entry.contains("/tmp/.mount_") {
        return true;
    }
    appdir.is_some_and(|appdir| {
        !appdir.is_empty()
            && (entry == appdir || entry.starts_with(&format!("{appdir}/")))
    })
}

/// Drop mount entries from a path-list value; `None` when nothing host-side
/// remains and the variable should be removed from the child.
fn strip_mount_entries(
    value: &OsStr,
    appdir: Option<&str>,
) -> Option<OsString> {
    let value = value.to_str()?;
    let kept: Vec<&str> = value
        .split(':')
        .filter(|entry| !entry_under_mount(entry, appdir))
        .collect();
    if kept.iter().all(|entry| entry.is_empty()) {
        None
    } else {
        Some(OsString::from(kept.join(":")))
    }
}

/// True when the current environment looks like an AppImage, including the
/// case where the markers are already gone but a mount path still leaks
/// through a loader variable (observed in the B6 crash log).
fn in_appimage() -> bool {
    if APPIMAGE_MARKER_VARS
        .iter()
        .any(|var| std::env::var_os(var).is_some())
    {
        return true;
    }
    let appdir = std::env::var_os("APPDIR");
    let appdir = appdir.as_deref().and_then(OsStr::to_str);
    APPIMAGE_ENV_VARS.iter().any(|(var, old)| {
        [var, old].iter().any(|name| {
            std::env::var_os(name).is_some_and(|value| {
                value.to_str().is_some_and(|value| {
                    value
                        .split(':')
                        .any(|entry| entry_under_mount(entry, appdir))
                })
            })
        })
    })
}

/// Overrides to apply to a child command so it does not inherit the AppImage
/// mount. Empty outside an AppImage, leaving native builds untouched.
pub fn appimage_env_overrides() -> Vec<(String, Option<OsString>)> {
    if !in_appimage() {
        return Vec::new();
    }
    let appdir = std::env::var_os("APPDIR");
    let appdir = appdir.as_deref().and_then(OsStr::to_str);
    let mut overrides = Vec::with_capacity(
        APPIMAGE_ENV_VARS.len() + APPIMAGE_MARKER_VARS.len(),
    );
    for (var, old) in APPIMAGE_ENV_VARS {
        if let Some(old_value) = std::env::var_os(old) {
            overrides.push(((*var).to_string(), Some(old_value)));
        } else if let Some(value) = std::env::var_os(var) {
            overrides.push((
                (*var).to_string(),
                strip_mount_entries(&value, appdir),
            ));
        }
    }
    for marker in APPIMAGE_MARKER_VARS {
        overrides.push(((*marker).to_string(), None));
    }
    overrides
}

fn apply(
    overrides: Vec<(String, Option<OsString>)>,
    mut set: impl FnMut(&str, Option<&OsStr>),
) {
    for (name, value) in overrides {
        set(&name, value.as_deref());
    }
}

/// Scrub a `std::process::Command` (used by the desktop opener on Linux).
pub fn scrub_appimage_env(cmd: &mut std::process::Command) {
    apply(appimage_env_overrides(), |name, value| match value {
        Some(value) => {
            cmd.env(name, value);
        }
        None => {
            cmd.env_remove(name);
        }
    });
}

/// Scrub a `tokio::process::Command` (used by the game and processor spawns).
pub fn scrub_appimage_env_async(cmd: &mut tokio::process::Command) {
    apply(appimage_env_overrides(), |name, value| match value {
        Some(value) => {
            cmd.env(name, value);
        }
        None => {
            cmd.env_remove(name);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    static ENV_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    const VARS: &[&str] = &[
        "APPIMAGE",
        "APPDIR",
        "ARGV0",
        "OWD",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "PATH",
        "XDG_DATA_DIRS",
        "GTK_PATH",
        "GTK_EXE_PREFIX",
        "GTK_DATA_PREFIX",
        "GTK_IM_MODULE_FILE",
        "GDK_PIXBUF_MODULE_FILE",
        "GIO_MODULE_DIR",
        "GIO_EXTRA_MODULES",
        "GI_TYPELIB_PATH",
        "GSETTINGS_SCHEMA_DIR",
        "OLD_LD_LIBRARY_PATH",
        "OLD_LD_PRELOAD",
        "OLD_PATH",
        "OLD_XDG_DATA_DIRS",
        "OLD_GTK_PATH",
        "OLD_GTK_EXE_PREFIX",
        "OLD_GIO_MODULE_DIR",
        "OLD_GIO_EXTRA_MODULES",
    ];

    fn with_clean_env<T>(set: impl FnOnce(), run: impl FnOnce() -> T) -> T {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        let original: Vec<_> = VARS
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect();
        unsafe {
            for name in VARS {
                std::env::remove_var(name);
            }
        }
        set();
        let result = run();
        unsafe {
            for (name, value) in original {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
        result
    }

    fn child_env(
        cmd: &std::process::Command,
    ) -> HashMap<String, Option<OsString>> {
        cmd.get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(OsStr::to_os_string),
                )
            })
            .collect()
    }

    #[test]
    fn restores_old_values_and_drops_markers() {
        with_clean_env(
            || unsafe {
                std::env::set_var("APPIMAGE", "/tmp/owyx.AppImage");
                std::env::set_var("APPDIR", "/tmp/.mount_owyx");
                std::env::set_var("OLD_LD_LIBRARY_PATH", "/usr/lib");
                std::env::set_var("OLD_LD_PRELOAD", "/usr/lib/libpreload.so");
                std::env::set_var(
                    "LD_LIBRARY_PATH",
                    "/tmp/.mount_owyx/usr/lib",
                );
                std::env::set_var(
                    "LD_PRELOAD",
                    "/tmp/.mount_owyx/usr/lib/libpreload.so",
                );
                std::env::set_var("OLD_GTK_PATH", "/usr/lib/gtk");
                std::env::set_var("OLD_GIO_MODULE_DIR", "/usr/lib/gio/modules");
                std::env::set_var("GTK_PATH", "/tmp/.mount_owyx/usr/lib/gtk");
                std::env::set_var("GTK_EXE_PREFIX", "/tmp/.mount_owyx/usr");
                std::env::set_var(
                    "GIO_MODULE_DIR",
                    "/tmp/.mount_owyx/usr/lib/gio/modules",
                );
                std::env::set_var(
                    "GIO_EXTRA_MODULES",
                    "/tmp/.mount_owyx/usr/lib/gio/extra",
                );
            },
            || {
                let mut cmd = std::process::Command::new("xdg-open");
                scrub_appimage_env(&mut cmd);
                let env = child_env(&cmd);
                assert_eq!(
                    env["LD_LIBRARY_PATH"].as_deref(),
                    Some(OsStr::new("/usr/lib"))
                );
                assert_eq!(
                    env["LD_PRELOAD"].as_deref(),
                    Some(OsStr::new("/usr/lib/libpreload.so"))
                );
                assert_eq!(
                    env["GTK_PATH"].as_deref(),
                    Some(OsStr::new("/usr/lib/gtk"))
                );
                assert_eq!(
                    env["GIO_MODULE_DIR"].as_deref(),
                    Some(OsStr::new("/usr/lib/gio/modules"))
                );
                // Vars without an OLD_* counterpart that point only into the
                // mount must be removed from the child (Some(None)).
                assert_eq!(env.get("APPIMAGE"), Some(&None));
                assert_eq!(env.get("APPDIR"), Some(&None));
                assert_eq!(env.get("GTK_EXE_PREFIX"), Some(&None));
                assert_eq!(env.get("GIO_EXTRA_MODULES"), Some(&None));
            },
        );
    }

    #[test]
    fn strips_mount_entries_without_old_fallback() {
        // The B6 crash log had no APPIMAGE/APPDIR/OLD_* but still leaked the
        // mount through LD_LIBRARY_PATH; that must be detected and stripped.
        with_clean_env(
            || unsafe {
                std::env::set_var(
                    "LD_LIBRARY_PATH",
                    "/tmp/.mount_Owyx_0mbaNQ7/usr/lib/:/usr/lib:/tmp/.mount_Owyx_0mbaNQ7/lib64/",
                );
                std::env::set_var(
                    "PATH",
                    "/tmp/.mount_Owyx_0mbaNQ7/usr/bin/:/usr/bin:/bin",
                );
            },
            || {
                let mut cmd = std::process::Command::new("xdg-open");
                scrub_appimage_env(&mut cmd);
                let env = child_env(&cmd);
                assert_eq!(
                    env["LD_LIBRARY_PATH"].as_deref(),
                    Some(OsStr::new("/usr/lib"))
                );
                assert_eq!(
                    env["PATH"].as_deref(),
                    Some(OsStr::new("/usr/bin:/bin"))
                );
            },
        );
    }

    #[test]
    fn noop_outside_appimage() {
        with_clean_env(
            || unsafe {
                // A plain loader path, but no AppImage marker and no mount
                // entry, must leave the child environment untouched.
                std::env::set_var("LD_LIBRARY_PATH", "/usr/lib");
            },
            || {
                let mut cmd = std::process::Command::new("xdg-open");
                scrub_appimage_env(&mut cmd);
                assert_eq!(cmd.get_envs().count(), 0);
            },
        );
    }

    #[test]
    fn scrubs_the_async_command_too() {
        with_clean_env(
            || unsafe {
                std::env::set_var("APPIMAGE", "/tmp/owyx.AppImage");
                std::env::set_var(
                    "LD_LIBRARY_PATH",
                    "/tmp/.mount_owyx/usr/lib",
                );
            },
            || {
                let mut cmd = tokio::process::Command::new("java");
                scrub_appimage_env_async(&mut cmd);
                let env: HashMap<_, _> = cmd
                    .as_std_mut()
                    .get_envs()
                    .map(|(key, value)| {
                        (
                            key.to_string_lossy().into_owned(),
                            value.map(OsStr::to_os_string),
                        )
                    })
                    .collect();
                assert_eq!(env.get("APPIMAGE"), Some(&None));
                assert_eq!(env.get("LD_LIBRARY_PATH"), Some(&None));
            },
        );
    }
}
