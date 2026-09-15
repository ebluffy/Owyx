# Agent notes — Owyx launcher

Canonical product: **Owyx** = `apps/app` + `apps/app-frontend` + `packages/app-lib`, rebranded from the Modrinth App shell.

## Do

- Follow upstream `modrinth/code` for features/fixes; **keep the GitHub fork relationship**.
- Brand from **`brand/`** — `brand/DESIGN.md`, prefer `brand/v2/` (Sora, cyan `#00e5ff`, bg `#050508`).
- Control plane: `https://api.owyx.site` + header `X-Owyx-Client-Key` (placeholder / settings only — **never commit real keys**).
- Offline nickname + Microsoft login both live in `packages/app-lib` auth; see `docs/ms-oauth.md`.
- Old stack archive: **https://github.com/ebluffy/OwyxOld** only.

## Do not

- Ship Modrinth logos, wrench-in-labyrinth marks, green-as-primary, Hosting/Medal upsell chrome, or claim to be Modrinth.
- Re-add a `legacy/` folder into this repo.
- Mass-rename `@modrinth/*` packages (upstream merge hygiene) — document as a follow-up.
- Commit `.env`, real client keys, `*.exe`, or other secrets.
- Unfork / delete the upstream remote / rewrite history to hide origin.

## Pointers

| Topic | Where |
|-------|--------|
| Design tokens | `brand/DESIGN.md` |
| Logos / icons | `brand/v2/` |
| MS OAuth | `docs/ms-oauth.md` |
| Owyx Servers client | `apps/app-frontend/src/helpers/owyx-api.ts` |
| Offline accounts | `Credentials::create_offline` in `packages/app-lib/src/state/minecraft_auth.rs` |

Cloud task paste (local only): `promt.md` (gitignored).
