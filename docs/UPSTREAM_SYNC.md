# Safe sync from `modrinth/code`

How to pull **important** upstream updates into [ebluffy/Owyx](https://github.com/ebluffy/Owyx) **without losing Owyx work**.

This is the executable playbook. The short README stub (`git merge upstream/main` on `main`) is **not** enough — follow this file.

**Do not** open PRs against [modrinth/code](https://github.com/modrinth/code). Sync PRs target **`ebluffy/Owyx` `main` only**.

Measured on **2026-09-24** against:

| Ref | SHA | Note |
|-----|-----|------|
| Owyx `main` | `1f421de75` | launcher **0.10.0** |
| Upstream `main` | `e977cc867` | 2026-09-24 |
| Fork point | `adf6b25424e6` | inside upstream `v0.21.3` |

The fork point is inside the `0.21` line: `v0.21.0` through `v0.21.3` are already in Owyx history. The first release range to audit is therefore **after** `adf6b25424e6`, especially upstream `v0.21.4` and `v0.21.5`, followed by selected launcher fixes from upstream `main`. A normal merge is possible from this shared ancestor, but do it only on the sync branch and review every conflict. Re-measure before each sync (`git rev-list --left-right --count main...upstream/main` and `git merge-base main upstream/main`).

---

## Forbidden

- `git reset --hard upstream/main` (or any reset/rebase that **rewrites Owyx `main`**).
- Force-push `main`.
- Discard or overwrite `owyxsite/`, `brand/`, `TRADEMARK.md`, `COPYING.md`, `docs/ms-oauth.md`, SemVer scripts.
- Mass-rename `@modrinth/*` packages during the sync (upstream merge hygiene — see `AGENTS.md`).
- Unfork / delete the `upstream` remote / rewrite history to hide origin.
- Opening the sync PR against `modrinth/code`.
- Merging the sync **directly into `main`** without a review PR.

---

## Remotes

```bash
# origin = this fork
git remote -v
# origin    https://github.com/ebluffy/Owyx.git

# parent (GitHub "fork of"); name may already be `upstream` or `modrinth`
git remote add upstream https://github.com/modrinth/code.git   # if missing
# if someone named it `modrinth`:
#   git remote add upstream https://github.com/modrinth/code.git
#   # or: git fetch modrinth main && use modrinth/main below
```

Always fetch **named** remotes. Do not assume `origin` tracks Modrinth.

---

## Playbook (every sync)

### 1. Start from latest Owyx `main`

```bash
git fetch origin main
git checkout main
git pull origin main
```

Never start a sync from a stale local `main`.

### 2. Create a dated sync branch (not `main`)

```bash
git fetch upstream main
git checkout -b sync/modrinth-YYYYMMDD origin/main
# example: sync/modrinth-20260924
```

### 3. Select and port upstream commits

Because the fork has a shared ancestor at `adf6b25424e6`, a normal merge is technically available. Do not use `--allow-unrelated-histories`. For the 0.21 audit, prefer a release-range or selected-commit allowlist first; use a full `git merge upstream/main` only when the sync PR explicitly reviews the complete launcher diff and all conflicts.

Create a small allowlist of reviewed upstream commits, then port them one at a time:

```bash
# Inspect before applying; paths and the complete patch must be reviewed.
git show --stat --summary <upstream-sha>
git show --format=fuller --find-renames <upstream-sha> -- <allowed-paths>

# Apply the selected commit to the sync branch.
git cherry-pick -x <upstream-sha>
# Resolve conflicts manually, keeping Owyx hooks, then:
git add <resolved-files>
git cherry-pick --continue
```

For a commit with an incompatible parent or a large mixed diff, export only the reviewed hunks with `git format-patch`/`git apply --3way` or reproduce the fix manually. Do not use `git cherry-pick -m` as a shortcut. Abort is allowed only on the sync branch (`git cherry-pick --abort`); never reset or rewrite `main`.

After every port, inspect `git show --stat HEAD`, `git diff HEAD^ HEAD --name-status`, and the protected-path checklist before applying the next commit.

### 4. Resolve conflicts with Owyx-first rules

| Keep Owyx (ours / `HEAD` on the sync branch) | Take upstream when it does not wipe Owyx features |
|----------------------------------------------|---------------------------------------------------|
| Branding, product name, `owyx://` scheme, About strings | Shared `packages/app-lib` bugfixes (instance IDs, sqlite `BEGIN IMMEDIATE`, pack import, screenshots) |
| `owyxsite/` entire tree | CI hygiene in `.github/workflows/turbo-ci.yml` **if** `modrinth/code` gates stay (`if: github.repository == 'modrinth/code'`) |
| `brand/`, `TRADEMARK.md`, `COPYING.md`, SemVer (`scripts/set-app-version.js`, `.cursor/rules/semver.mdc`) | `cargo clippy` / rustfmt / prettier / eslint cleanups that do not revert Owyx helpers |
| Custom Social / Servers / skins / telemetry (`owyx-*.ts`, `OwyxServers.vue`, `FriendsList.vue` Owyx path, `error-reporting.ts`) | Locale **keys** from Crowdin for non-EN/RU — merge keys, keep Owyx `owyx.*` + EN/RU product copy |
| `docs/`, `AGENTS.md`, launcher client key / `X-Owyx-Client-Key` | Upstream auth **soft-fails** that keep the UI visible (do not re-enable PostHog / Sentry DSN) |
| Disabled Hosting chrome, `/hosting/manage*` → `/owyx-servers` | `packages/ui` Hosting layouts may come back for merge hygiene — **do not remount** them in `apps/app-frontend` |
| `apps/app` updater RID soft-fail (`updater_impl.rs`) | Upstream updater fixes — keep the stale-RID `Ok(None)` / `UpdaterRidStale` guards |

When a hunk mixes both: take upstream logic, **re-apply** the Owyx hook (telemetry opt-in, presence slug, pack ACL headers, OS label, skin upload path).

### 5. Watch these high-risk paths

Files that are high-risk for a selected patch (non-locale). Do not apply an upstream patch touching these paths without reviewing every hunk:

**Launcher shell (Owyx-first)**

- `apps/app-frontend/src/App.vue` — presence, telemetry, SharedInstance mount
- `apps/app-frontend/src/components/ui/friends/FriendsList.vue` — Owyx friends, not `plugin:friends`
- `apps/app-frontend/src/helpers/analytics.ts` — must stay a no-op (no PostHog)
- `apps/app-frontend/src/pages/Index.vue` — Library (server packs must stay visible, #127)
- `apps/app-frontend/src/pages/Browse.vue`
- `apps/app-frontend/src/helpers/instance.ts`
- `apps/app-frontend/src/components/ui/settings/display/{Behavior,Features}Settings.vue`
- `apps/app-frontend/src/components/ui/shared-instances/**`

**Rust / instances (take upstream fixes, keep Owyx pack path)**

- `packages/app-lib/src/state/instances/commands/create_instance.rs` — Owyx curated packs live under `profiles/servers/`
- `packages/app-lib/src/state/instances/commands/mod.rs`
- `packages/app-lib/src/state/settings.rs`
- `packages/app-lib/src/api/pack/import/mod.rs`
- `packages/app-lib/src/launcher/mod.rs`
- `packages/app-lib/Cargo.toml`
- `apps/app/src/api/instance.rs`
- `apps/app/build.rs`
- `Cargo.toml`

**CI (keep fork gates)**

- `.github/workflows/turbo-ci.yml` — Namespace cache only on `modrinth/code`; fork uses `ubuntu-latest`
- `.github/workflows/theseus-build.yml` / `theseus-release.yml` — must stay skipped on this fork
- `.github/workflows/{labrinth-build,daedalus-docker,frontend-deploy,frontend-docker}.yml`

**Locales** — almost every `apps/app-frontend/src/locales/*/index.json` and `packages/ui/src/locales/*/index.json`. Strategy: accept upstream key additions, then `pnpm turbo run intl:extract` and restore Owyx `owyx.*` + ru-RU product strings.

**Owyx-only (upstream will never contain these — ours wins, no merge needed unless you added them under an upstream-tracked path):**

- `owyxsite/**`
- `brand/**`
- `apps/app-frontend/src/helpers/owyx-*.ts`
- `apps/app-frontend/src/pages/OwyxServers.vue`, `OwyxAdmin.vue`
- `apps/app/src/updater_impl.rs` RID guards
- `docs/UPSTREAM_SYNC.md`, `docs/AUDIT_*.md`

### 6. Upstream commits worth taking (as of 2026-09-24)

Safe / high value for the **launcher** (review each hunk):

| Upstream | Why |
|----------|-----|
| `#7628` `BEGIN IMMEDIATE` + sqlite lifetime | Data-loss / lock bugs |
| `#7617` instance IDs ending in `.` or ` ` | Corrupt instance ids |
| `#7618` external file renames vs mp updates | Pack update correctness |
| `#7602` symlinked screenshots | Library screenshots |
| `#7603` command history vs duplicate instance | Duplicate flow |
| `#7637` instance page perf | UX |
| `#7561` stop rewriting unchanged `instance_files` | Perf / disk |
| `#7582` disable content-store validate on play | Launch reliability |
| `#7619` move settings out of feature flags | Settings architecture — **re-apply Owyx toggles** (telemetry, presence) |
| `#7605` download-manager tooltip | UX |
| `#7604` AltGr | Input |

Skip or isolate (Modrinth product / not Owyx surface):

- Labrinth validators, ads.txt, Stripe/charge IDs, Sentry sourcemaps, websocket metrics, Crowdin dumps for `apps/frontend`
- `#7601` PostHog PageView — **do not** re-enable PostHog; `analytics.ts` stays stubbed
- `#7678` Modrinth App changelog 0.21.5 — do not retag Owyx as 0.21.5; SemVer for Owyx is independent (`0.10.0` now)

### 7. Test checklist (after conflict resolution, before merge to `main`)

Run what the environment allows; record skips.

**Fork CI (must stay meaningful)**

- [ ] `pnpm --filter @modrinth/app-frontend lint` (eslint + prettier)
- [ ] `pnpm --filter @modrinth/app lint` (`cargo fmt --check`, `cargo clippy --all-targets`)
- [ ] `pnpm turbo run intl:extract && pnpm scripts i18n-icu-contract prune-local --check` + no dirty `*/locales/*/index.json`
- [ ] `check-generic` (typos + tombi) / `check-rust` (shear)
- [ ] Do **not** require green `theseus-build` / `theseus-release` (gated to `modrinth/code`)

**Owyx product smoke (launcher)**

- [ ] Sign in: Owyx site JWT + Microsoft (see `docs/ms-oauth.md`)
- [ ] Library lists downloaded **server packs** as instances
- [ ] Owyx Servers: Play, copy address, **Settings** opens instance modal
- [ ] Friends: status is a human name, not `owyx-server:<id>`; Join still respects `requiresAccount`
- [ ] Skins: Owyx offline + site session can apply/upload **even if Mojang sessionserver is down**
- [ ] Telemetry toggle off → no `/v1/telemetry` and no PostHog/Sentry
- [ ] About shows **Windows 11** on build ≥ 22000 (not `10.0.xxxxx`)
- [ ] No new `The resource id … is invalid` in admin Logs after updater clicks

**Site**

- [ ] `owyxsite` login / `/api/launcher/me` / catalog ACL / pack download
- [ ] Discord OAuth still uses `state` + pending cookie (no JWT in the query string)
- [ ] Password change still revokes long-term API tokens

**Release**

- [ ] Version left alone unless you intend a SemVer bump (`scripts/set-app-version.js`). A sync is not automatically `0.11.0`.
- [ ] Do not publish from the sync branch until smoke above is done.

### 8. Use the working sync PR

Push the sync branch and keep the reviewed upstream commits plus conflict report in one PR:

```bash
git push -u origin sync/modrinth-0.21-YYYYMMDD
# PR base = ebluffy/Owyx main
# PR head = sync/modrinth-0.21-YYYYMMDD
```

The sync PR may also contain follow-up Owyx fixes discovered by Auto-Review, but keep them in separate commits after the upstream port. Do not merge or publish until the CI and smoke checklist are green.

Title idea: `sync: Modrinth App 0.21.4-0.21.5 launcher fixes`.

Body must list: upstream SHA(s), selected commit rationale, changed paths, any manually re-applied Owyx hooks, what was kept Owyx vs taken upstream, and the smoke checklist. If `git merge-base` is empty, explicitly say that the sync used reviewed patches rather than a full merge.

---

## After merge of the sync PR

1. Tag nothing automatically.
2. Watch `turbo-ci` — ClickHouse `up --wait` is currently flaky on the fork (see `docs/AUDIT_2026-09-24.md`).
3. If Crowdin push fails (missing secrets), that is expected; do not "fix" by adding upstream Crowdin IDs.
4. Next product work stays on feature branches off the new `main`.
