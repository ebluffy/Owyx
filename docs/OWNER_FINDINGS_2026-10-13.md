# Owner findings — 2026-10-13 (B1–B7 tracker)

Tracking PR: `docs/owner-findings-2026-10-13` (baseline `main` @ `e3f91d986`, i.e. after PR #170).
This PR started as findings-only; it now **also carries code fixes** for B1, B2, B4, B6 and B7 (see *Fix status*
per item and the *Auto-review closure* section at the end). Every item below is owner-observed on
the device (CachyOS + KDE Wayland, launcher **0.12.3**, AppImage).

---

## B1 · “Playing as” panel does not see the Owyx site session

- **Issue:** [#172](https://github.com/ebluffy/Owyx/issues/172)
- **Sev:** P1 (auth UX; forces a redundant re-login)
- **Symptom:** after signing in to the Owyx account, the right-hand **Playing as** panel still
  shows as if not signed in, and you have to click through **Sign in with Owyx account** from
  that panel and authorize _again_.
- **Repro:** sign in via the account modal (browser or password) → look at the right sidebar
  “Playing as” → it does not reflect the new session.
- **Actual cause (code, not a snapshot):**
  - Before this PR, `AccountsCard.vue` rendered the “not signed in” empty state whenever
    `accounts.length === 0`, with **no** check of `owyxSite.isSignedIn`. So a valid site session
    with no Play (offline) profile still shows the sign-in prompt.
  - The modal sign-in path (`ModrinthAccountRequiredModal` → `@signed-in="refreshOwyxSiteSession"`)
    only refreshes `owyxSiteSession`; it never seeds the Play profile. `login_offline_flow` (which
    the panel’s own button called) is what creates that profile.
  - `owyx-site-session.ts` hands the provider the `ref` itself and exposes `isSignedIn` as a
    `computed` — propagation is fine, so “stale snapshot” was the wrong lead.
- **Fix (this PR):** `AccountsCard.vue` now `watch`es `owyxSite.isSignedIn` and, on the false→true
  transition, seeds the Play profile via `login_offline_flow` (the same helper the button uses),
  then refreshes values. Automatic seeding (watch/logout) is skipped when any Minecraft profile
  already exists. Explicit panel sign-in adds the Owyx offline profile beside existing accounts
  with `makeActive=false`, preserving the selected Microsoft account; a matching offline nickname
  (compared without case sensitivity, as in the avatar lookup)
  is not added again. With no accounts, either path creates and selects the profile. Actual
  creation shares an in-flight promise across both paths; an automatic skip does not block the
  explicit request. Regression tests cover passive addition, concurrent creation and retry.

## B2 · Launcher scrollbar not hidden behind the instance-settings modal

- **Issue:** [#173](https://github.com/ebluffy/Owyx/issues/173)
- **Sev:** P3 (visual polish)
- **Symptom:** with instance **Settings** open, the underlying launcher’s own scrollbar is still
  visible on the right, outside/behind the modal — the page behind is not scroll-locked.
- **Actual cause:** `NewModal.vue` scroll-locks `document.body` in `show()` and resets it in
  `hide()` and unmount cleanup. But the sidebar is **not** `body`-scrolled —
  `.app-sidebar-scrollable` owns its own OverlayScrollbars instance, so a `body.overflow` lock
  cannot hide its track.
- **Fix (this PR):** the app’s `provideModalBehavior` hook (`App.vue`) shares a hold counter across
  `NewModal`, image viewers and fullscreen consoles. It toggles `owyx-modal-open` on `<html>` and
  takes/releases the ads hold only on the 0→1 / 1→0 transitions. Closing a nested viewer keeps
  the sidebar scrollbar hidden until the last window closes; covered by `modal-holds.test.ts`.

## B3 · Whole launcher feels laggy (~“10 FPS”)

- **Issue:** [#174](https://github.com/ebluffy/Owyx/issues/174)
- **Sev:** P2 (perceived performance; platform-level)
- **Symptom:** the launcher UI feels sluggish generally, as if running at ~10 FPS.
- **Notes / what to check:**
  - Wayland/WebKitGTK compositing path on KDE; compare against X11 (`GDK_BACKEND=x11`).
  - Whether the sidebar/`OverlayScrollbars` + backdrop-filter blur is the bottleneck.
- **No code change in this PR** — needs profiling first.

## B4 · “Open folder” does not open the folder

- **Issue:** [#175](https://github.com/ebluffy/Owyx/issues/175)
- **Sev:** P2
- **Symptom:** the instance **Open folder** action does nothing.
- **Actual cause:** `apps/app/src/api/utils.rs` `open_path()` → `app.opener().open_path(..)` is the
  **same desktop-portal opener** that failed to open the browser on Linux in #169. The AppImage
  env scrub (`scrub_appimage_env`) was applied only to the `xdg-open` browser path, **not** to this
  opener. `highlight_in_folder()` (`utils.rs`, `reveal_item_in_dir`) shares the opener
  and, worse, swallowed its error (`tracing::error!` only) — the failure was silent.
- **Fix (this PR):**
  - Both `open_path` and `highlight_in_folder` now try the **scrubbed `xdg-open`** first on Linux
    and only fall back to the portal opener, mirroring the #169 approach.
  - Both return `Result<()>` and propagate the error to the UI instead of logging it away; the
    frontend actions in `Instance.vue`, `QuickInstanceSwitcher.vue`, library `instance-card.vue`,
    world `InstanceItem.vue`, and instance `layout.vue`, `files/index.vue`, `content/index.vue`,
    `worlds/index.vue` now `.catch(handleError)`, so a failure is a visible notification.
  - On Linux the `xdg-open` fallback opens the parent folder without selecting the file.
    Other platforms retain the opener’s file-selection behavior.

## B5 · Verify the `mc` instance exported/imported correctly from `mc.mrpack` (removable disk)

- **Issue:** [#176](https://github.com/ebluffy/Owyx/issues/176)

- **Sev:** P3 (verification)
- **Status:** manual verification only — **not a code change** and out of scope here. No `.mrpack`
  round-trip regression was reproduced; if it recurs, open a dedicated issue with the archive.

## B6 · Game crashes on launch (SIGSEGV in bundled `libwayland-client`) — P0

- **Issue:** [#177](https://github.com/ebluffy/Owyx/issues/177)
- **Sev:** **P0 — the game does not launch.**
- **Build:** launcher **0.12.3** (AppImage, build after the #170 merge). This game crash is separate
  from #169's browser-opening symptom, which is tracked under B7 / #178.
- **Status:** fixed in code; awaiting game-launch verification on the owner's AppImage.
- **Symptom:** the instance starts, the client logs to `Stopping!` /
  `Saving axiom configuration (client stopping)...`, then the process is hard-killed.
- **Environment:** CachyOS + KDE **Wayland**, launcher **0.12.3** (AppImage), instance `mc 1.0.0`
  (Fabric **26.3** loader `0.19.5`), Java **Zulu 25** (`zulu25.36.205-ca-jre25.0.4.1-linux_x64`).

### Two different signals — the JVM turns the SEGV into an abort

- `hs_err_pid1832622.log` (in the instance dir): **`SIGSEGV (0xb) at pc=0x00007f387ff7a627`**,
  `tid=1832623`, crashing frame `C  [libwayland-client.so.0+0x5627]`.
- `systemd-coredump` report: **`Signal: 6 (ABRT) si_code: SI_TKILL`**, thread `1832623 (Render thread)`,
  with the JVM handler stack: `JVM_handle_linux_signal` → `VMError::report_and_die` →
  `os::abort(false)` → `abort (libc.so.6)`.
- So the recorded **SIGABRT is a consequence**: the Render thread took a **SIGSEGV inside
  `libwayland-client`**, and the JVM aborted the whole process.

### Likely root cause: the game JVM inherits the AppImage's loader env

- `hs_err_pid1832622.log` shows the crashing library resolved **into the AppImage mount**:

  ```
  RBP=0x00007f387ff80000: <offset 0x000000000000b000> in /tmp/.mount_Owyx_0mbaNQ7/usr/lib/libwayland-client.so.0 at 0x00007f387ff75000
  ```

- Full inherited search path (verbatim, AR-8):

  ```
  LD_LIBRARY_PATH=/tmp/.mount_Owyx_0mbaNQ7/usr/lib/:/tmp/.mount_Owyx_0mbaNQ7/usr/lib/i386-linux-gnu/:/tmp/.mount_Owyx_0mbaNQ7/usr/lib/x86_64-linux-gnu/:/tmp/.mount_Owyx_0mbaNQ7/usr/lib32/:/tmp/.mount_Owyx_0mbaNQ7/usr/lib64/:/tmp/.mount_Owyx_0mbaNQ7/lib/:/tmp/.mount_Owyx_0mbaNQ7/lib/i386-linux-gnu/:/tmp/.mount_Owyx_0mbaNQ7/lib/x86_64-linux-gnu/:/tmp/.mount_Owyx_0mbaNQ7/lib32/:/tmp/.mount_Owyx_0mbaNQ7/lib64/:
  ```

  The mount's `usr/lib/` **is** first — so the loader takes `libwayland-client.so.0` from the mount.
- The full `Environment Variables` section of the crash log contains **no** `LD_PRELOAD`, **no**
  `APPIMAGE`, **no** `APPDIR`, and **no** `OLD_*` — only `PATH`/`LD_LIBRARY_PATH` pointing at the
  mount. So the earlier “restore `OLD_*`” idea cannot help here; entries must be **stripped from
  the path variables themselves**, and the helper's trigger must not depend on `APPIMAGE`/`APPDIR`
  being present.
- The crash frame and mount-first loader path support AppImage library contamination as a
  hypothesis. They do not establish an ABI mismatch or prove that removing the path fixes the
  crash; the client library does not link against `libwayland-server`.
- **This is the same class of bug as #169 / B4:** the AppImage's injected env leaks into a child
  process. #170 scrubbed it only for the **browser opener** (`xdg-open`), never for the game.

### Verification (AR-8) — reproduced the loader behaviour

- Direct loader proof on this host: with `LD_LIBRARY_PATH=<mount>/usr/lib:/usr/lib`, `ldd` resolves
  `libwayland-client.so.0` to the **mount** copy; with the dump-path removed it resolves to
  `/usr/lib/libwayland-client.so.0`. So a mount-first `LD_LIBRARY_PATH` alone is sufficient for the
  child to load the mount library — no `LD_PRELOAD`/RPATH needed.
- Still required on the affected device: repeat the same game launch with the scrubbed
  environment, confirm the host library is loaded, and confirm the game reaches the menu.
  The `ldd` check only establishes library resolution; it is not a crash-recovery test.
- Unit test in `theseus` (`strips_mount_entries_without_old_fallback`) asserts exactly the B6 shape:
  mount entries in `LD_LIBRARY_PATH`/`PATH`, **no** `APPIMAGE`/`APPDIR`/`OLD_*`, and requires the
  child env to end up mount-free.

### Where the fix goes

- The game JVM is spawned by **`theseus` (`packages/app-lib/src/launcher/mod.rs`)**, a different
  crate than the Tauri app. `scrub_appimage_env` lived in `apps/app/src/api/utils.rs` as a
  `pub(crate)` helper, so it **could not be reused** from the launcher (AR-7). Calling it “reuse”
  as-is would not even compile, and the two code paths were drifting.
- **Fix (this PR):** the helper is now a single implementation in
  `packages/app-lib/src/util/appimage_env.rs` (exported as `theseus::scrub_appimage_env` /
  `scrub_appimage_env_async`). It restores real values from `OLD_*` when present, otherwise strips
  mount entries from path-list variables and drops the variable if nothing host-side remains; it
  triggers on any AppImage marker **or** any mount entry in a loader/path variable. It is wired
  into:
  - the **game JVM spawn** (`launcher/mod.rs`, before `Command` is handed to the process manager);
  - the **processor spawn** (`launcher/mod.rs`), which had the same leak;
  - the `apps/app` opener paths (browser + folder) now delegate to it.

### Evidence files (on the machine)

- `hs_err_pid1832622.log` — instance dir (`profiles/mc 1.0.0/`): SIGSEGV, `libwayland-client.so.0`,
  `LD_LIBRARY_PATH` under `/tmp/.mount_Owyx_0mbaNQ7`, no `LD_PRELOAD`/`APPIMAGE`/`APPDIR`/`OLD_*`.
- `profiles/mc 1.0.0/logs/latest.log` — clean shutdown to `Stopping!` then hard death, no Java trace.
- `profiles/mc 1.0.0/logs/launcher_log.txt` — JVM banner written by the crashing client.
- `systemd-coredump`: `core.java.1000.<boot>.1832622.1791892215000000.zst` (420.9M), thread
  `1832623 (Render thread)`.

## B7 · Browser still does not auto-open on Owyx sign-in (P1)

- **Issue:** [#178](https://github.com/ebluffy/Owyx/issues/178)

- **Sev:** P1 (auth UX regression / incomplete #170)
- **Build:** launcher **0.12.3** (AppImage), same box as above.
- **Status:** fixed in code; awaiting automatic browser-opening verification on the owner's AppImage.
- **Symptom:** after the #170 fix, launching the system browser automatically still does **not**
  happen. The **Copy link** fallback works end to end (copy → open manually → “Return to launcher”
  → authorized), so sign-in is usable, but auto-open is still broken.
- **Likely cause:** #170 only scrubbed `LD_LIBRARY_PATH`/`LD_PRELOAD`/`GTK_PATH`/`GTK_EXE_PREFIX`/
  `GIO_*`. The linuxdeploy GTK `AppRun` hook also exports `PATH` (mount-first), `XDG_DATA_DIRS`,
  `GTK_DATA_PREFIX`, `GTK_IM_MODULE_FILE`, `GDK_PIXBUF_MODULE_FILE`, `GI_TYPELIB_PATH`,
  `GSETTINGS_SCHEMA_DIR`. Because `PATH` is still mount-first, even a “scrubbed” `xdg-open`
  resolves to the **bundled** `/tmp/.mount_*/usr/bin/xdg-open`, which uses the bundled GTK stack.
- **Fix (this PR):** the shared helper now also strips mount entries from `PATH`/`XDG_DATA_DIRS`
  (keeping host entries) and drops `GTK_DATA_PREFIX`/`GTK_IM_MODULE_FILE`/`GDK_PIXBUF_MODULE_FILE`/
  `GI_TYPELIB_PATH`/`GSETTINGS_SCHEMA_DIR` when they point under the mount — so the opener runs the
  host `xdg-open` with the host GTK stack.
  Inspection of the built `AppRun` also confirmed `QT_PLUGIN_PATH`, `PYTHONPATH`,
  `GST_PLUGIN_SYSTEM_PATH` and `GST_PLUGIN_SYSTEM_PATH_1_0` injection; these are now scrubbed too.
  Mount-only GStreamer overrides are removed so its standard system plugin search is restored;
  host path entries and `OLD_*` values are preserved. Covered by a Rust regression test.

---

## Auto-review closure (AR-1 … AR-18)

Addressing every item from all AR rounds in **this** PR (AR-5): the `.md` edits close here, and the
B1, B2, B4, B6 and B7 code fixes also land here. B3 / #174 (profiling) and B5 / #176
(archive round-trip verification) remain open and are not closed by this PR.

| ID | Sev | Item | Status |
|---|---|---|---|
| AR-1 | P2 | B1 hook rewritten — real cause is the empty-state guard + missing profile seeding | ✅ Fixed |
| AR-2 | P2 | Browser symptom extracted as B7 / #178, separate from the B6 / #177 game crash | ✅ Fixed |
| AR-3 | P3 | `highlight_in_folder` added to B4; `open_path` now returns `Result` and shows the error in the UI | ✅ Fixed |
| AR-4 | P3 | B2 references identify lock in `show()`, reset in `hide()` and unmount cleanup by function | ✅ Fixed |
| AR-5 | P2 | AR findings close in this PR; only code B1–B5 was movable — code now lands here too | ✅ Fixed |
| AR-6 | P3 | stale screenshot references removed (no images in the PR) | ✅ Fixed |
| AR-7 | P2 | helper moved into `theseus` and shared by game/processor/opener spawns; no cross-crate call | ✅ Fixed |
| AR-8 | P2 | Loader evidence retained; unsupported ABI/symbol claims removed; crash-recovery verification explicitly pending | ✅ Fixed in documentation |
| AR-9 | P3 | handoff corrected: the game-spawn scrub does **not** cover B4; B4 fixed on its own path | ✅ Fixed |
| AR-10 | P3 | title/body updated to **B1–B7**; `LD_LIBRARY_PATH` value aligned with this doc | ✅ Fixed |
| AR-11 | P2 | Shared modal hold counter preserves lock and ads hold for nested viewers | ✅ Fixed; regression test added |
| AR-12 | P2 | Remaining folder actions catch errors; Linux parent-folder behavior documented | ✅ Fixed |
| AR-13 | P3 | Panel and watcher share one profile-seeding promise; skip guard documented accurately | ✅ Fixed |
| AR-14 | P3 | Stale source line numbers replaced by function/file references | ✅ Fixed |
| AR-15 | P3 | B6 crash separated from #169 / B7 browser symptom | ✅ Fixed |
| AR-16 | P2 | PR body closes code-fix issues; B3/B5 remain open; B6/B7 device verification pending | ✅ Metadata corrected |
| AR-17 | P2 | Explicit Owyx sign-in adds a missing offline profile beside Microsoft without switching selection; automatic restore keeps its empty-account guard | ✅ Fixed; regression tests added |
| AR-18 | P3 | Offline nickname matching ignores case, consistent with the account avatar lookup | ✅ Fixed; `steve` / `Steve` regression test added |
