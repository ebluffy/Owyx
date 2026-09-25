# Owyx

**Owyx** is a desktop Minecraft launcher (and small control-plane site) for private / friends servers: dark UI, cyan brand, curated **Owyx Servers**, **Owyx site account** sign-in (offline play uses your unique login nick), and Microsoft login for licensed play.

## Fork notice (please read)

This repository is a **public GitHub fork of [modrinth/code](https://github.com/modrinth/code)** (Modrinth / Rinth, Inc.).

We keep the **fork relationship** so we can pull upstream fixes. We **rebrand and extend** the tree for the Owyx product — we are **not** Modrinth, not affiliated with Rinth, Inc., and we do **not** use Modrinth trademarks, logos, or product name in the shipping Owyx UI.

| | |
|--|--|
| Upstream | https://github.com/modrinth/code |
| This fork | https://github.com/ebluffy/Owyx |
| Website | https://owyx.site |
| Control plane | https://api.owyx.site |
| Brand kit | [`brand/`](./brand/) · [`brand/DESIGN.md`](./brand/DESIGN.md) · `brand/v2/` |
| Tokens | bg `#050508` · accent `#00e5ff` · font **Sora** |

Older private Owyx experiments (previous launcher / plugin archive): **https://github.com/ebluffy/OwyxOld** — do **not** re-add a `legacy/` tree here.

## Layout

| Path | What |
|------|------|
| `apps/app` | Tauri shell → **Owyx** binary (`owyx://` deep links) |
| `apps/app-frontend` | Launcher UI (Vue) |
| `packages/app-lib` | Launcher core (Rust) |
| `brand/` | Owyx logos, hero art, design tokens |
| `owyxsite/` | Owyx control-plane (site + API + deploy) — our code, not upstream |
| `docs/ms-oauth.md` | Microsoft OAuth notes for owners |
| `apps/frontend`, `apps/labrinth`, … | Upstream packages kept for sync |

## Features (launcher)

- **Owyx chrome** — logos, window title, Discord RPC, cyan theme
- **Owyx Servers** — catalog from `api.owyx.site` (`X-Owyx-Client-Key`; settings + optional demo seed)
- **Offline nickname** — deterministic offline UUID for offline-mode servers
- **Microsoft login** — see `docs/ms-oauth.md`

`api.modrinth.com` may still be used as a **content catalog API host**. That is API infrastructure, not Modrinth product branding.

## Dev

```bash
pnpm install
pnpm app:dev
```

Optional env (never commit secrets):

```bash
export OWYX_API_BASE_URL=http://127.0.0.1:3001
# VITE_OWYX_CLIENT_KEY=…   # frontend build-time placeholder only
```

Site / API (see `owyxsite/README.md` and `.env.example`):

```bash
cd owyxsite && docker compose up
```

## Upstream sync

**Do not** merge `upstream/main` straight onto `main` and **never** reset `main` to Modrinth.

Full playbook: [`docs/UPSTREAM_SYNC.md`](./docs/UPSTREAM_SYNC.md) — sync branch, Owyx-first conflict rules, high-risk paths, test checklist.

```bash
git remote add upstream https://github.com/modrinth/code.git   # if missing
git fetch origin main && git fetch upstream --tags main
git checkout -b sync/modrinth-0.21-YYYYMMDD origin/main
# Start after the fork point (inside upstream v0.21.3); review v0.21.4/v0.21.5 first.
git log --oneline adf6b25424e6..upstream/v0.21.5 -- apps/app apps/app-frontend packages/app-lib
# Apply only the reviewed launcher commits, or merge upstream on this branch after a full diff review.
```

Do not mass-rename `@modrinth/*` packages in drive-by PRs (keeps merges sane). Do not unfork.

## License

**Same licenses as upstream [modrinth/code](https://github.com/modrinth/code).**

- Per-package terms apply (see each package’s `LICENSE` / `COPYING.md`). The Modrinth App / Theseus-derived launcher packages are **GNU General Public License v3**.
- A GPL-3 copy is at the repo root: [`LICENSE`](./LICENSE).
- Trademark / branding rules from upstream: [`COPYING.md`](./COPYING.md) — Modrinth marks stay with Rinth, Inc.; this fork ships **Owyx** branding only.

We redistribute and modify under those terms in good faith: attribution via the fork link above, no Modrinth trademark use, source available in this public repository.
