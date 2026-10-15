use std::{env, fs};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Mode {
    Auto,
    Wayland,
    X11,
    Compatibility,
}

impl Mode {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "auto" => Some(Self::Auto),
            "wayland" => Some(Self::Wayland),
            "x11" => Some(Self::X11),
            "compatibility" => Some(Self::Compatibility),
            _ => None,
        }
    }
}

fn overrides(
    mode: Mode,
    wayland_session: bool,
    nvidia: bool,
) -> Vec<(&'static str, &'static str)> {
    let mut values = Vec::new();
    let use_wayland = mode == Mode::Wayland
        || (mode == Mode::Auto && wayland_session && nvidia);
    if use_wayland {
        // The AppImage GTK hook forces x11, even inside a Wayland session.
        values.push(("GDK_BACKEND", "wayland"));
        if nvidia {
            values.push(("__NV_DISABLE_EXPLICIT_SYNC", "1"));
        }
    } else if matches!(mode, Mode::X11 | Mode::Compatibility) {
        values.push(("GDK_BACKEND", "x11"));
    }
    if mode == Mode::Compatibility {
        values.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
    }
    values
}

fn has_nvidia_driver() -> bool {
    if std::path::Path::new("/proc/driver/nvidia/version").exists() {
        return true;
    }
    fs::read_dir("/sys/class/drm").is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            fs::read_to_string(entry.path().join("device/vendor"))
                .is_ok_and(|vendor| vendor.trim() == "0x10de")
        })
    })
}

// Called first in main, before GTK or any application threads are started.
pub fn configure() {
    let config = dirs::config_dir().and_then(|dir| {
        fs::read_to_string(dir.join("Owyx/linux-graphics")).ok()
    });
    let requested = env::var("OWYX_LINUX_GRAPHICS").ok().or(config);
    let mode = requested
        .as_deref()
        .and_then(Mode::parse)
        .unwrap_or(Mode::Auto);
    if requested.is_some()
        && requested.as_deref().and_then(Mode::parse).is_none()
    {
        eprintln!("Owyx: invalid Linux graphics mode; using auto");
    }
    let wayland = env::var_os("WAYLAND_DISPLAY")
        .is_some_and(|display| !display.is_empty());
    let values = overrides(mode, wayland, has_nvidia_driver());
    for (key, value) in values {
        // Keep user-supplied renderer workarounds; GDK_BACKEND may instead have
        // been supplied by the bundled GTK hook, so our selected mode wins.
        if key == "GDK_BACKEND" || env::var_os(key).is_none() {
            // SAFETY: configure is the first operation in the single-threaded main.
            unsafe { env::set_var(key, value) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_only_changes_nvidia_wayland_sessions() {
        for (wayland, nvidia) in [(false, false), (true, false), (false, true)]
        {
            assert!(overrides(Mode::Auto, wayland, nvidia).is_empty());
        }
        assert_eq!(
            overrides(Mode::Auto, true, true),
            vec![
                ("GDK_BACKEND", "wayland"),
                ("__NV_DISABLE_EXPLICIT_SYNC", "1")
            ]
        );
    }

    #[test]
    fn explicit_modes_allow_recovery_without_rebuilding() {
        assert_eq!(
            overrides(Mode::X11, true, true),
            vec![("GDK_BACKEND", "x11")]
        );
        assert_eq!(
            overrides(Mode::Compatibility, true, true),
            vec![
                ("GDK_BACKEND", "x11"),
                ("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
            ]
        );
        assert_eq!(
            overrides(Mode::Wayland, true, false),
            vec![("GDK_BACKEND", "wayland")]
        );
        assert_eq!(Mode::parse("wayland\n"), Some(Mode::Wayland));
        assert_eq!(Mode::parse("typo"), None);
    }
}
