# Owner findings — 2026-10-13 (WIP tracker)

Tracking PR: opened from `docs/owner-findings-2026-10-13` (baseline `main` @ `e3f91d986`, i.e. after PR #170).
**No code fixes in this PR** — findings only. Every item below is owner-observed on the device
(CachyOS + KDE Wayland, launcher **0.12.3**, AppImage).

Context for #170: after the fix, launching the system browser automatically still does **not**
happen on this box — but the **Copy link** path works end-to-end (copy → open manually →
"Return to launcher" → authorized). So #169 is effectively usable even without auto-open.

---

## B1 · “Playing as” panel does not see the Owyx site session

- **Sev:** P1 (auth UX; forces a redundant re-login)
- **Symptom:** after signing in to the Owyx account, the right-hand **Playing as** panel still
  shows as if not signed in, and you have to click through **Sign in with Owyx account** from
  that panel and authorize _again_.
- **Repro:** sign in via the account modal (browser or password) → look at the right sidebar
  “Playing as” → it does not reflect the new session.
- **Likely area:**
  - `apps/app-frontend/src/components/ui/AccountsCard.vue` — the panel’s `owyxSite.isSignedIn`
    source.
  - `apps/app-frontend/src/App.vue:1426` `refreshOwyxSiteSession()` and the
    `@signed-in="refreshOwyxSiteSession"` wiring on `ModrinthAccountRequiredModal`
    (`App.vue:2187`); `owyxSiteSession.value` propagation into the provider.
  - `apps/app-frontend/src/helpers/owyx-site-auth.ts:157` `hydrateOwyxSiteSession()` +
    `getStoredOwyxSiteSession()` (memory session vs. reactive `owyxSiteSession`).
- **Open question:** is the panel reading a _snapshot_ captured before hydration, or is the
  reactive session not propagated from `App.vue` into `AccountsCard`? Needs repro with devtools.

## B2 · Launcher scrollbar not hidden behind the instance-settings modal

- **Sev:** P3 (visual polish)
- **Symptom:** with instance **Settings** open (screenshot 3), the underlying launcher’s own
  scrollbar is still visible on the right, outside/behind the modal — the page behind is not
  scroll-locked.
- **Likely area:** `packages/ui/src/components/modal/NewModal.vue` —
  `document.body.style.overflow` is set/reset around open/close (see `:539`), but the modal here
  is `no-padding`/custom; check whether the scroll-lock path is actually used by the instance
  settings modal, and whether the scroll owner is `body` vs. an inner scroll container.

## B3 · Whole launcher feels laggy (~“10 FPS”)

- **Sev:** P2 (perceived performance; platform-level)
- **Symptom:** the launcher UI feels sluggish generally, as if running at ~10 FPS.
- **Notes / what to check:**
  - Wayland/WebKitGTK compositing path on KDE; compare against X11 (`GDK_BACKEND=x11`) and vs.
    the native (non-AppImage) build.
  - Isolated to the AppImage env scrub, or global? (Does it predate #170 / 0.12.3?)
  - Long-running Vue reactivity / interval work (e.g. logs stream, telemetry) saturating the
    main thread.
- **Open question:** needs profiling before any fix; not investigated yet.

## B4 · “Open folder” does not open the folder

- **Sev:** P2
- **Symptom:** the instance **Open folder** action (screenshot 4) does nothing.
- **Likely area:** `apps/app/src/api/utils.rs:1191` `open_path()` → `app.opener().open_path(..)`.
  This is the **same desktop-portal opener** that failed to open the browser on Linux in #169;
  the **AppImage env scrub** (`scrub_appimage_env`) was applied only to the `xdg-open` browser
  path, **not** to this opener. Strong candidate: same portal/`APPIMAGE`/`APPDIR` leakage.
- **Fix direction (later):** route `open_path` (and `show_launcher_logs_folder`) through the same
  scrubbed `xdg-open` first on Linux, mirroring the #169 approach. **Not done in this PR.**

## B5 · Verify the `mc` instance exported/imported correctly from `mc.mrpack` (removable disk)

- **Sev:** P2 (data integrity — verify only)
- **Symptom / ask:** confirm the `mc` instance (Fabric 26.3, Fabric loader 0.19.5) was built
  correctly from `mc.mrpack` on the removable drive `Нуда`.
- **Evidence to capture:**
  - `mc.mrpack` sha256 + size, and the source path on `Нуда`.
  - Import log lines and the resolved instance dir; diff of expected vs. actual mod list /
    `mods/*.jar` count and versions.
  - Confirm `.mrpack` `overrides/` and `modrinth.index.json` files all landed.
- **Status:** not verified yet.

## B6 · Minecraft (game) crashes on launch — SIGABRT / SIGSEGV in `libwayland-client` from the AppImage mount

- **Sev:** P0 (game does not start at all; blocks the core product loop)
- **Symptom:** launching the instance starts the JVM, the client loads (mods, resources, Xaero/REI/ETF
  all initialize), then the process **dies during startup** in the **Render thread**. No Java
  exception is logged — the log just ends at `[Render thread/INFO]: Stopping!` / `Saving axiom
configuration (client stopping)...` and the process is killed.
- **Environment:** CachyOS + KDE **Wayland**, launcher **0.12.3** (AppImage), instance `mc 1.0.0`
  (Fabric **26.3** loader `0.19.5`), Java **Zulu 25** (`zulu25.36.205-ca-jre25.0.4.1-linux_x64`).

### Two different signals — the JVM turns the SEGV into an abort

- `hs_err_pid1832622.log` (in the instance dir): **`SIGSEGV (0xb) at pc=0x00007f387ff7a627`**,
  `tid=1832623`, crashing frame `C  [libwayland-client.so.0+0x5627]`.
- `systemd-coredump` report: **`Signal: 6 (ABRT) si_code: SI_TKILL`**, thread `1832623 (Render thread)`,
  with the JVM handler stack: `JVM_handle_linux_signal` → `VMError::report_and_die` →
  `os::abort(false)` → `abort (libc.so.6)`.
- So the recorded **SIGABRT is a consequence**: the Render thread took a **SIGSEGV inside
  `libwayland-client`**, and the JVM aborted the whole process. The `#7  0x00007f387ff7a627 n/a (n/a + 0x0)`
  frame in the coredump is the un-mapped Wayland stub — no symbol because it lives in the mount.

### Root cause: the game JVM inherits the AppImage's `LD_LIBRARY_PATH`

- `hs_err_pid1832622.log` shows the crashing library resolved **into the AppImage mount**:

  ```
  RBP=0x00007f387ff80000: <offset 0x000000000000b000> in /tmp/.mount_Owyx_0mbaNQ7/usr/lib/libwayland-client.so.0 at 0x00007f387ff75000
  ```

- Same file records the inherited search path:

  ```
  LD_LIBRARY_PATH=/tmp/.mount_Owyx_0mbaNQ7/usr/lib/x86_64-linux-gnu/:/tmp/.mount_Owyx_0mbaNQ7/lib32/:/tmp/.mount_Owyx_0mbaNQ7/lib64/
  ```

- `110` references to `mount_Owyx` in the crash log — the child JVM is loading the AppImage's
  bundled ICU/wayland/etc. instead of the **system** libraries it should use on this host.
- Concretely: the wayland client stub from inside the AppImage is ABI-mismatched with the running
  `libwayland-server`/`wl_display` (KDE compositor), so the first protocol marshal in the render
  thread jumps through a null/stale proxy → `wl_proxy_marshal_flags` style SIGSEGV.
- **This is the exact same class of bug as #169 / B4:** the AppImage's injected env leaks into a
  child process. #170 scrubbed it only for the **browser opener** (`xdg-open`), never for the game.

### Where the fix goes (not done in this PR)

- `packages/app-lib/src/launcher/mod.rs` — the **game JVM spawn** (`Command::new(&java_version.path)`
  built around `L1015–L1164`) removes only `_JAVA_OPTIONS` (and, on macOS-under-Cargo,
  `DYLD_FALLBACK_LIBRARY_PATH`). It does **not** remove the AppImage env.
- Fix direction: before spawning the game, **scrub the AppImage env the same way #169 did** —
  drop `APPIMAGE`, `APPDIR`, `ARGV0`, and any `LD_LIBRARY_PATH` / `LD_PRELOAD` entry that points
  under `/tmp/.mount_*` (keep the launcher's own libs; only the AppImage mount entries go). The
  existing `scrub_appimage_env` helper should be reused here instead of a browser-only path.
- Note the processor spawn at `mod.rs:663` has the same issue (it also inherits the mount path).
- Secondary hardening (separate from the env bug): forcing the client to **GLFW/X11 or native
  Wayland GLFW** and/or providing a real system `libwayland-client` via `LD_PRELOAD` is a workaround,
  **not** the fix — the fix is not leaking the AppImage mount into the child at all.

### Evidence files (on the machine)

- `hs_err_pid1832622.log` — instance dir (`profiles/mc 1.0.0/`): SIGSEGV, `libwayland-client.so.0`,
  `LD_LIBRARY_PATH` under `/tmp/.mount_Owyx_0mbaNQ7`.
- `profiles/mc 1.0.0/logs/latest.log` — clean shutdown to `Stopping!` then hard death, no Java trace.
- `profiles/mc 1.0.0/logs/launcher_log.txt` — JVM banner written by the crashing client.
- `systemd-coredump`: `core.java.1000.<boot>.1832622.1791892215000000.zst` (420.9M), thread
  `1832623 (Render thread)`.
- Launch command (abridged): `... -Djava.library.path=.../meta/natives/26.3-0.19.5/java ... com.modrinth.theseus.MinecraftLaunch net.fabricmc.loader.impl.launch.knot.KnotClient ... --gameDir '/home/ebluffy/.local/share/Owyx/profiles/mc 1.0.0'`.

- **Open question:** confirm by relaunching the **same instance** outside the AppImage (native/deb
  build, clean env) — it should start; and/or `env -u LD_LIBRARY_PATH -u APPIMAGE -u APPDIR <java ...>`
  manually. If it starts, the AppImage env leak is proven beyond doubt.

---

## Handoff

- B1 is the highest-value auth fix; B4 looks like a #169 sibling (same opener/portal).
- **B6 is P0 — the game does not launch.** Its root cause is the **same AppImage env leak** as
  #169/B4 (`LD_LIBRARY_PATH` from `/tmp/.mount_*` reaching a child); #170 only scrubbed the browser
  opener. Fixing the env scrub for the **game JVM spawn** (`packages/app-lib/src/launcher/mod.rs`)
  should cover B6 and most likely B4 at once.
- B3 needs profiling before touching code.
- B5 is verification, not a code change.
- Expect Auto-Review to add its own findings once this PR is up; fix every AR item in a follow-up
  PR (code changes deliberately excluded here).
