# CI failure log (Owyx)

Append-only notes when CI goes red. Use this **before** digging blindly — match the failing job/step, apply the known fix, then re-run the local gate below.

## Local fast gate (before push)

```bash
# 1) Frontend lint on touched files
pnpm --filter @modrinth/app-frontend exec eslint --fix <paths>
pnpm --filter @modrinth/app-frontend exec prettier --write <paths>
pnpm --filter @modrinth/app-frontend exec prettier --check <paths>

# 2) Unit tests for Owyx helpers / site ingest
node --experimental-strip-types --test apps/app-frontend/src/helpers/*.test.ts
node --test owyxsite/backend/src/routes/catalog-ingest.test.js

# 3) i18n — required whenever defineMessages / formatMessage strings change
pnpm turbo run intl:extract --filter=@modrinth/app-frontend --force
pnpm scripts i18n-icu-contract prune-local --check
# Every en-US key must exist in ru-RU (Crowdin pull is skipped without secrets):
node -e "const en=require('./apps/app-frontend/src/locales/en-US/index.json'); const ru=require('./apps/app-frontend/src/locales/ru-RU/index.json'); const m=Object.keys(en).filter(k=>!ru[k]); if(m.length){console.error('ru-RU missing',m.length,'keys:\n'+m.join('\n')); process.exit(1)} console.log('ru-RU covers all en-US keys')"
git diff --exit-code -- apps/app-frontend/src/locales/*/index.json

# 4) Rust fmt (apps/app) when touching apps/app/src/**
# cargo fmt --manifest-path apps/app/Cargo.toml
# cargo fmt --check --manifest-path apps/app/Cargo.toml
```

Full playbook: [`CI_PLAYBOOK.md`](./CI_PLAYBOOK.md).

---

## Entries

### 2026-10-05 · PR #165 · AR round 11 · I18N-2

- **I18N-2:** `app.action-bar.install.backing-up-instance` and `app.action-bar.install.summary.content-no-longer-installed` (from #164) were in en-US but not ru-RU. Prior pass only checked `owyx.*`.
- **Fix:** translate both; gate now fails if **any** en-US key is missing from ru-RU (not only `owyx.*`).

### 2026-10-05 · PR #165 · AR round 10 · I18N-1 / DOC-1 / DOC-2

- **I18N-1:** new E2/admin `owyx.*` keys existed in `en-US` but not `ru-RU` (fallback to English). Also filled similar missing: `export-files-label`, `kubejs-missing-warn`, `pack-version-label`.
- **DOC-1:** local gate omitted `pnpm scripts i18n-icu-contract prune-local --check` (CI runs it).
- **DOC-2:** restoring post-merge F1 (history purge / SMTP rotate) and O3 (CSP smoke) into `AUDIT_OWNER_2026-10-03.md` after old trackers were deleted.

### 2026-10-05 · PR #165 · run `37284932460` · Lint and Test

- **Step:** `Verify intl:extract has been run`
- **Symptom:** `git diff --exit-code …/*/src/locales/*/index.json` exit 1; diff in `apps/app-frontend/src/locales/en-US/index.json`
- **Cause:** New Owyx Servers / Admin strings (`pack-update-*`, changelog, update-target-pack) were added in Vue but `intl:extract` was not committed.
- **Fix:** `pnpm turbo run intl:extract --filter=@modrinth/app-frontend --force`, then `pnpm scripts i18n-icu-contract prune-local --check`, commit locale JSON (+ `ru-RU` for `owyx.*`).
- **Prevention:** Always run extract + ICU check after any `defineMessages` / new `formatMessage` id in app-frontend; translate new `owyx.*` keys in `ru-RU` by hand.

### 2026-10-05 · PR #165 · run `37281424593` · Lint and Test

- **Failed packages:** `@modrinth/app-frontend#lint`, `@modrinth/app#lint`
- **app-frontend**
  - `owyx-pack-socket.test.ts`: `@typescript-eslint/no-unsafe-function-type` — do not use `Function`; use `(...args: unknown[]) => void`.
  - `OwyxServers.vue` / `owyx-server-instances.ts`: `simple-import-sort/imports` — run eslint `--fix`.
- **app**
  - `apps/app/src/api/utils.rs`: `cargo fmt --check` — break long `let canonical = tokio::fs::canonicalize…` assignment.
- **Fix:** eslint autofix + typed handlers + rustfmt-shaped assignment; commit `7ab4dfee8`.
- **Prevention:** Local gate steps 1 + 4 above; never leave `Function` in TS linted by app-frontend eslint.

### 2026-10-05 · PR #165 · earlier rounds (AR / lint notes)

- Prettier / import order on catalog ingest helpers and Owyx Vue pages — always `eslint --fix` + `prettier --write` on touched files.
- Rust `cargo fmt` and Clippy treat warnings as errors (`-Dwarnings`).

### 2026-10-06 · PR #167 · run `37437111993` · Lint and Test

- **Failed package:** `@modrinth/app#lint` (clippy via `-D warnings`)
- **Symptom:** `error: this if statement can be collapsed` at `apps/app/src/api/utils.rs:289` (`clippy::collapsible_if` on nested `if let` in `owyx_ingest_error_message`).
- **Cause:** AR-8 error-message helper used nested `if let Ok` + `if let Some` without `else`.
- **Fix:** collapse with `if let … && let …` let-chains; return early when JSON `error` is non-empty.
- **Prevention:** after editing `apps/app/src/**`, run `cargo clippy -p theseus_gui -- -D warnings` (or the package lint script CI uses).

### 2026-10-06 · PR #167 · run `37434911709` · Lint and Test

- **Step:** `Check Owyx backend` → `npm run audit:prod` (`npm audit --omit=dev`)
- **Symptom:** exit 1 — `2 vulnerabilities (1 high, 1 critical)`
  - `compression` `<1.8.2` — DoS via memory leak on premature response close ([GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95))
  - `proxy-addr` `1.1.0–2.0.7` — IP spoofing via IPv4-mapped IPv6 trust subnet ([GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h))
- **Cause:** transitive deps in `owyxsite/backend/package-lock.json` lagged advisories; direct `"compression": "^1.7.4"` still resolved an older vulnerable tree until lock refreshed.
- **Fix:** `cd owyxsite/backend && npm audit fix --omit=dev` (commit updated `package-lock.json`); re-check with `npm audit --omit=dev` → `found 0 vulnerabilities`.
- **Prevention:** After any backend dep change, run `npm run audit:prod` locally before push (same gate as CI).

### 2026-10-06 · release v0.12.0 · Publish exit 141

- **Symptom:** Windows + Linux builds OK; `Publish GitHub Release` failed with exit **141** (SIGPIPE). No GitHub Release created.
- **Cause:** `set -o pipefail` + `git log … | head -n 40` — more than 40 commits since previous Owyx release closes `head` early and fails the step.
- **Fix:** use `git log -n 40` (no pipe to `head`); prefer previous published release tag via `gh release list`.
