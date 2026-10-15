use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

const ACTIVE: &str = "OWYX_SYSTEM_RUNTIME_ACTIVE";

fn system_requested(env_mode: Option<&str>, file_mode: Option<&str>) -> bool {
    env_mode
        .or(file_mode)
        .is_some_and(|mode| mode.trim() == "system")
}

fn system_library_path() -> Option<OsString> {
    let mut paths = Vec::new();
    for dir in [
        "/usr/lib/x86_64-linux-gnu",
        "/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
        "/lib/aarch64-linux-gnu",
        "/usr/lib64",
        "/lib64",
        "/usr/lib",
        "/lib",
    ] {
        if let Ok(path) = fs::canonicalize(dir)
            && path.is_dir()
            && !paths.contains(&path)
        {
            paths.push(path);
        }
    }
    if paths.is_empty() {
        None
    } else {
        env::join_paths(paths).ok()
    }
}

fn already_active(
    active: Option<&OsStr>,
    current: Option<&OsStr>,
    desired: &OsStr,
) -> bool {
    // AppRun rewrites the loader path on restart, including after an update.
    active == Some(OsStr::new("1")) && current == Some(desired)
}

fn host_command(exe: &Path, libraries: &OsStr) -> Command {
    let mut command = Command::new(exe);
    theseus::scrub_appimage_env(&mut command);
    // The updater must still replace the original AppImage, not its mounted ELF.
    for marker in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] {
        if let Some(value) = env::var_os(marker) {
            command.env(marker, value);
        }
    }
    command
        .env("LD_LIBRARY_PATH", libraries)
        .env(ACTIVE, "1")
        .env_remove("WEBKIT_EXEC_PATH")
        .env_remove("WEBKIT_INJECTED_BUNDLE_PATH")
        .env_remove("GDK_BACKEND");
    command
}

fn host_dependencies(trace: &str, appdir: &Path) -> bool {
    !trace.contains("not found")
        && !trace
            .split_whitespace()
            .any(|word| Path::new(word).starts_with(appdir))
        && [
            "libwebkit2gtk-4.1.so",
            "libjavascriptcoregtk-4.1.so",
            "libgtk-3.so",
        ]
        .iter()
        .all(|library| {
            trace.lines().any(|line| {
                line.trim_start().starts_with(library) && line.contains("=> /")
            })
        })
}

// Run before GTK initialization. Re-exec is required: the loader has already
// mapped the bundled libraries by the time main starts.
pub fn configure() {
    let config = dirs::config_dir().and_then(|dir| {
        fs::read_to_string(dir.join("Owyx/linux-runtime")).ok()
    });
    if !system_requested(
        env::var("OWYX_LINUX_RUNTIME").ok().as_deref(),
        config.as_deref(),
    ) {
        return;
    }
    let (Some(appdir), Some(_appimage)) =
        (env::var_os("APPDIR"), env::var_os("APPIMAGE"))
    else {
        return;
    };
    let Some(libraries) = system_library_path() else {
        return;
    };
    if already_active(
        env::var_os(ACTIVE).as_deref(),
        env::var_os("LD_LIBRARY_PATH").as_deref(),
        &libraries,
    ) {
        return;
    }
    let Ok(exe) = env::current_exe() else { return };
    let mut probe = host_command(&exe, &libraries);
    probe.env("LD_TRACE_LOADED_OBJECTS", "1");
    let usable = probe.output().is_ok_and(|output| {
        output.status.success()
            && output.stderr.is_empty()
            && host_dependencies(
                &String::from_utf8_lossy(&output.stdout),
                &PathBuf::from(appdir),
            )
    });
    if !usable {
        eprintln!(
            "Owyx: system WebKit/GTK dependencies unavailable; using bundled runtime"
        );
        return;
    }
    let error = host_command(&exe, &libraries)
        .args(env::args_os().skip(1))
        .exec();
    eprintln!(
        "Owyx: cannot start system runtime ({error}); using bundled runtime"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_runtime_is_opt_in_and_environment_takes_precedence() {
        assert!(!system_requested(None, None));
        assert!(system_requested(None, Some("system\n")));
        assert!(!system_requested(Some("bundled"), Some("system")));
        assert!(!system_requested(Some("typo"), Some("system")));
        assert!(system_requested(Some("system"), Some("bundled")));
    }

    #[test]
    fn updater_restart_must_reapply_system_loader_path() {
        let system = OsStr::new("/usr/lib");
        assert!(already_active(Some(OsStr::new("1")), Some(system), system));
        assert!(!already_active(
            Some(OsStr::new("1")),
            Some(OsStr::new("/tmp/.mount_new/usr/lib:/usr/lib")),
            system
        ));
        assert!(!already_active(None, Some(system), system));
    }

    #[test]
    fn reject_missing_or_mixed_host_dependencies() {
        let trace = "libwebkit2gtk-4.1.so.0 => /usr/lib/libwebkit2gtk-4.1.so.0 (0x1)\nlibjavascriptcoregtk-4.1.so.0 => /usr/lib/libjavascriptcoregtk-4.1.so.0 (0x2)\nlibgtk-3.so.0 => /usr/lib/libgtk-3.so.0 (0x3)\n";
        let mount = Path::new("/tmp/.mount_test");
        assert!(host_dependencies(trace, mount));
        assert!(!host_dependencies(
            &format!("{trace}libfoo.so => not found\n"),
            mount
        ));
        assert!(!host_dependencies(
            &format!(
                "{trace}libfoo.so => /tmp/.mount_test/usr/lib/libfoo.so (0x4)\n"
            ),
            mount
        ));
        assert!(!host_dependencies(
            "libgtk-3.so.0 => /usr/lib/libgtk-3.so.0",
            mount
        ));
    }
}
