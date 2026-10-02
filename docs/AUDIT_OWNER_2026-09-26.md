# Owner findings + fixes (PR #162)

**Fix-PR** for owner pack after #141. Base: `main` @ `13fd4bf` · updated 2026-10-02.

---

## Status

| ID | Item | Sev | Status |
|---|---|---|---|
| **O3** | CDN / third-party images blocked by CSP `img-src` | P0/P1 | fixed — whitelist `cdn.modrinth.com` (+ raw/staging) + `flagcdn.com` |
| **O1** | Language flags empty | P1 | fixed with O3 (`flagcdn.com`) |
| **O2** | Launcher session drops quickly | P2 / ops | diagnosed — see below |
| **O2a** | Neyra/dashboard redeploy kills login | P2 / ops | JWT + Postgres bind mount stable; secret only randomized on first `.env` create |
| **O4** | Browser “sign in via site” | feature | ✅ MVP loopback SSO (`/launcher-auth` + prepare/exchange) |
| **O5** | Password = min 8 only | P3 / UX | fixed — backend + register UI + i18n |
| **O6** | Sync Modrinth App 0.21.6 | P2 / sync | cherry-picked (skip labrinth/changelog) |

---

## O3 CSP smoke (owner, POST-MERGE)

Not a code blocker in #162. After `v0.11.0` is installed:

1. Content tab icons, pack search previews, language flags.
2. Webview DevTools: no `Refused to load the image … img-src`.
3. Extra hosts → whitelist in `apps/app/tauri.conf.json` `csp.img-src` only (no `*`).

---

## O2 / O2a VPS notes (2026-10-02 via `ssh owyxsite`)

- Host: `/opt/owyx`, compose `owyxsite/docker-compose.yml` + `docker-compose.prod.yml`.
- `JWT_SECRET` present in persistent `owyxsite/.env` (length 96). `vps-up.sh` only generates secrets when `.env` is **missing**.
- Postgres data bind: `/opt/owyx/owyxsite/postgres/data` → container data dir (survives rebuild).
- Containers healthy ~6 days; `user_sessions` has live rows.
- Launcher login always sends `remember: true` (30d JWT). `fetchOwyxSiteMe` clears OS session only on 401/403; network/5xx keeps cache.
- `settings.tokenExpiration` aligned to `30d` and documented as informational (login hardcodes 24h/30d).

If sessions die mid-day after a deploy that **recreated** `.env` or wiped the postgres data dir, that is ops/expected — not a launcher TTL bug.

---

## O6 cherry-picks (`v0.21.5...v0.21.6`)

Taken: #7563, #7683, #7680, #7729, #7692 (update-all modal).  
Skipped: labrinth-only, changelog.
