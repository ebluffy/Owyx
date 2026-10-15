# Owyx on Linux

Download the x86_64 AppImage from [GitHub Releases](https://github.com/ebluffy/Owyx/releases),
make it executable, and launch it from a writable directory in your home folder:

```sh
chmod +x Owyx*.AppImage
./Owyx*.AppImage
```

Keep only one matching AppImage in that directory when using these commands.
The built-in updater installs the signed Linux AppImage from the same release
channel. A separate CachyOS/Arch build is not required. The release workflow
builds on Ubuntu 22.04; this does not guarantee compatibility with every Linux
distribution or graphics driver. Test published release artifacts on the target
system before recommending them broadly.

## System WebKit/GTK on rolling distributions

The AppImage bundles WebKit/GTK for compatibility with older distributions.
On CachyOS/KDE with NVIDIA, the same 0.12.5 executable scrolled a catalog at
about 30 FPS with bundled libraries and 60 FPS with system libraries. This is
one measured setup, not a guarantee for other drivers or distributions.

If native Wayland still stutters, install your distribution's WebKitGTK 4.1
and GTK 3 runtime packages (on Arch/CachyOS: `webkit2gtk-4.1` and `gtk3`), then
try the system runtime:

```sh
OWYX_LINUX_RUNTIME=system ./Owyx.AppImage
```

To keep this choice across normal launches and automatic updates:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/Owyx"
printf '%s\n' system > "${XDG_CONFIG_HOME:-$HOME/.config}/Owyx/linux-runtime"
```

The runtime file accepts `system` or `bundled`; `OWYX_LINUX_RUNTIME` takes
precedence. Remove the file or use `OWYX_LINUX_RUNTIME=bundled` to return to
the default. Owyx checks that its dependencies resolve outside the AppImage
before switching; missing or incompatible libraries keep the bundled runtime
and print a diagnostic to the terminal. A dependency check cannot guarantee
that a particular GPU driver renders correctly, so retain the bundled override
as a recovery option. Native packages already use system libraries.

This mode uses the same signed AppImage and preserves its updater path. No
personal build, cache deletion, or profile reset is needed. It takes effect
on the next launch. The graphics mode below is a separate setting.

## Wayland, NVIDIA, and blank windows

Owyx chooses native Wayland when a Wayland session and an NVIDIA driver/device
are detected. It also sets `__NV_DISABLE_EXPLICIT_SYNC=1` unless already set.
This avoids the AppImage GTK hook's forced X11 backend on that setup. Other
setups retain the bundled backend choice. Windows startup is unaffected.

The native Wayland mode was manually tested on CachyOS/KDE with NVIDIA RTX 4050:
the interface rendered correctly and scrolling improved substantially. This
does not establish that every NVIDIA/Wayland combination works.

To override the choice for one launch:

```sh
OWYX_LINUX_GRAPHICS=wayland ./Owyx.AppImage
OWYX_LINUX_GRAPHICS=x11 ./Owyx.AppImage
OWYX_LINUX_GRAPHICS=compatibility ./Owyx.AppImage
```

`wayland` needs a running Wayland session. `x11` needs X11 or XWayland.
`compatibility` uses X11 and disables WebKit's DMABUF renderer; it can fix a
blank window, but scrolling may be much slower. Existing user-supplied WebKit
workaround variables are preserved; remove old exported workarounds when testing
a faster mode. Explicit `OWYX_LINUX_GRAPHICS` modes take precedence over
`GDK_BACKEND`, including the value set by the AppImage's GTK hook.

To keep a mode across normal launches, desktop shortcuts, and updates:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/Owyx"
printf '%s\n' wayland > "${XDG_CONFIG_HOME:-$HOME/.config}/Owyx/linux-graphics"
```

The file accepts `auto`, `wayland`, `x11`, or `compatibility`.
`OWYX_LINUX_GRAPHICS` overrides the file. Remove the file to restore automatic
selection. This setting lives outside the AppImage, so no personal rebuild or
post-update repacking is needed. Graphics policy is compiled into the normal
binary before Tauri packages and signs the updater artifact.

See [Tauri's Linux graphics guide](https://v2.tauri.app/develop/debug/linux-graphics/)
for the upstream NVIDIA/WebKit workarounds. Do not disable acceleration for all
users as a blanket fix.

If the AppImage fails before opening any window because FUSE is unavailable,
try `APPIMAGE_EXTRACT_AND_RUN=1 ./Owyx.AppImage`. Install your distribution's
FUSE 2 compatibility package if needed. Do not run Owyx as root.
