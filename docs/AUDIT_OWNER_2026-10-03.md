# Owner findings 2026-10-03 (WIP tracker)

Рабочий список багов пачки. Актуальный статус — в комментарии PR #164 (тело PR агент не смог PATCH из‑за 403). Чиним коммитами в этом же PR.

Base: `main` @ `3493c64` (v0.11.1). HEAD ветки: см. `audit/owner-findings-2026-10-03`.

- G1 — скин Owyx `slice` → ✅ FIXED (`d0418455a`)
- G2 — Windows symlink 1314 → ✅ FIXED (`68b975e9e`)
- G3 — бэкап без прогресса / тяжёлые папки → ✅ FIXED (`dff824cd9`)
- G4 — ProgressBar точки → ✅ FIXED (`1c8eeece5`)
- G5 — Pause/Cancel на откате → ✅ FIXED (`92606d073`)
- G6 — selection после бэкапа → ✅ FIXED (`b8814aebb`)
- G7 — spam load_snapshot → ✅ FIXED (`cf611f026`)
- G8 — Turnstile bypass client key → ✅ FIXED (`97efd594b`)
- G9 — rate limit memory → ✅ FIXED (`e0c8e9cf1`)
- G10 — site_session ACL Windows → ✅ FIXED (`fd4840b5f`)
- G11 — `$DOCUMENT/**` scope → ✅ FIXED (`31ac2eab1`)
- G12 — Socket.IO revoke → ✅ FIXED (`5b2f170d1`)
- G13 — reset token race → ✅ FIXED (`15b1b518a`)
- G14 — cropData limits → ✅ FIXED (`65ed61613`)
- G15 — CF NeoForge→Vanilla → ✅ FIXED (`26df229c6`)
- G16 — wait_for DashMap lock → ✅ FIXED (`cef06bfc1`)
- G17 — npm audit backend → ✅ FIXED (`2cd092d90`)
- G18 — server pack без kubejs → ✅ FIXED (`720add723`)
- E1 — reuse parent pack → 🟡 foundation (`43a68078d`, cache + flag; hardlink/diff unfinished)
- E2 — update server pack from local → 🟡 foundation (`51b38af85`, version field + stub + migration 018; VPS apply by owner)
