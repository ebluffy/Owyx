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

---

## Handoff

- B1 is the highest-value fix; B4 looks like a #169 sibling (same opener/portal).
- B3 needs profiling before touching code.
- B5 is verification, not a code change.
- Expect Auto-Review to add its own findings once this PR is up; fix every AR item in a follow-up
  PR (code changes deliberately excluded here).
