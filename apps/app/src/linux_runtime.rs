use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

const ACTIVE: &str = "OWYX_SYSTEM_RUNTIME_ACTIVE";
const HOST_LD: &str = "OWYX_SYSTEM_RUNTIME_HOST_LD_LIBRARY_PATH";

fn system_requested(
    env_mode: Option<&str>,
    file_mode: Option<&str>,
) -> Result<bool, &'static str> {
    match env_mode.or(file_mode).map(str::trim) {
        Some("system") => Ok(true),
        None | Some("bundled") => Ok(false),
        Some(_) => Err("invalid Linux runtime mode; using bundled"),
    }
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

fn save_host_library_path(command: &mut Command) {
    let host_ld = match command
        .get_envs()
        .find(|(key, _)| *key == "LD_LIBRARY_PATH")
    {
        Some((_, value)) => value.map(OsStr::to_os_string),
        None => env::var_os("LD_LIBRARY_PATH"),
    };
    command.env_remove(HOST_LD);
    if let Some(value) = host_ld {
        command.env(HOST_LD, value);
    }
}

fn host_command(exe: &Path, libraries: &OsStr) -> Command {
    let mut command = Command::new(exe);
    theseus::scrub_appimage_env(&mut command);
    save_host_library_path(&mut command);
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
        .env_remove("WEBKIT_INJECTED_BUNDLE_PATH");
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

fn dependency_diagnostics<'a>(trace: &'a str, appdir: &Path) -> Vec<&'a str> {
    trace
        .lines()
        .filter(|line| {
            line.contains("not found")
                || line
                    .split_whitespace()
                    .any(|word| Path::new(word).starts_with(appdir))
        })
        .take(5)
        .collect()
}

// Run before GTK initialization. Re-exec is required: the loader has already
// mapped the bundled libraries by the time main starts.
pub fn configure() {
    let config = dirs::config_dir().and_then(|dir| {
        fs::read_to_string(dir.join("Owyx/linux-runtime")).ok()
    });
    match system_requested(
        env::var("OWYX_LINUX_RUNTIME").ok().as_deref(),
        config.as_deref(),
    ) {
        Ok(true) => {}
        Ok(false) => return,
        Err(reason) => {
            eprintln!("Owyx: {reason}");
            return;
        }
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
    let appdir = PathBuf::from(appdir);
    let usable = match probe.output() {
        Ok(output) => {
            let trace = String::from_utf8_lossy(&output.stdout);
            let usable = output.status.success()
                && output.stderr.is_empty()
                && host_dependencies(&trace, &appdir);
            if !usable {
                for line in dependency_diagnostics(&trace, &appdir) {
                    eprintln!("Owyx: {}", line.trim());
                }
                for line in
                    String::from_utf8_lossy(&output.stderr).lines().take(5)
                {
                    eprintln!("Owyx: {}", line.trim());
                }
            }
            usable
        }
        Err(error) => {
            eprintln!("Owyx: cannot check system dependencies: {error}");
            false
        }
    };
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
        assert_eq!(system_requested(None, None), Ok(false));
        assert_eq!(system_requested(None, Some("system\n")), Ok(true));
        assert_eq!(
            system_requested(Some("bundled"), Some("system")),
            Ok(false)
        );
        assert_eq!(system_requested(Some("system"), Some("bundled")), Ok(true));
        for invalid in ["typo", "System", ""] {
            assert!(system_requested(Some(invalid), Some("system")).is_err());
            assert!(system_requested(None, Some(invalid)).is_err());
        }
    }

    #[test]
    fn reexec_saves_original_loader_path_before_forcing_system_libraries() {
        for original in [None, Some(""), Some("/opt/cuda/lib")] {
            let mut command = Command::new("/test/Owyx");
            command.env_remove("LD_LIBRARY_PATH");
            if let Some(original) = original {
                command.env("LD_LIBRARY_PATH", original);
            }
            save_host_library_path(&mut command);
            command.env("LD_LIBRARY_PATH", "/usr/lib");
            let saved = command
                .get_envs()
                .find(|(key, _)| *key == HOST_LD)
                .unwrap()
                .1;
            assert_eq!(saved, original.map(OsStr::new));
        }
    }

    #[test]
    fn runtime_command_preserves_graphics_backend_selection() {
        let command =
            host_command(Path::new("/test/Owyx"), OsStr::new("/usr/lib"));
        assert!(command.get_envs().all(|(key, _)| key != "GDK_BACKEND"));
    }

    #[test]
    fn dependency_errors_identify_missing_and_bundled_libraries() {
        let trace = "libfoo.so => not found\nlibgtk-3.so => /usr/lib/libgtk-3.so (0x1)\nlibbar.so => /tmp/.mount_test/usr/lib/libbar.so (0x2)\n";
        assert_eq!(
            dependency_diagnostics(trace, Path::new("/tmp/.mount_test")),
            vec![
                "libfoo.so => not found",
                "libbar.so => /tmp/.mount_test/usr/lib/libbar.so (0x2)"
            ]
        );
        let many = "libfoo.so => not found\n".repeat(10);
        assert_eq!(
            dependency_diagnostics(&many, Path::new("/tmp/.mount_test")).len(),
            5
        );
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
