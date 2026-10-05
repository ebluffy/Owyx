# Owner findings 2026-10-03 (WIP tracker)

G1–G18 смержены в #164. E1/E2/P3 — PR #165 `feat/e1-e2-p3-pack-reuse-update`.

- G1–G18 → ✅ FIXED (#164)
- E1 — reuse parent pack → ✅ admin-device only (`owyx.packParentHint:<packId>`); orphan dup deleted; flag opt-in
- E2 — update server pack → ✅ content-addressed + SAVEPOINT rollback + confirm; badge Update clears dismiss (session-scoped); ru-RU strings for pack-update / admin update
- P3 — sha256 / socket / tests → ✅ streaming sha; ACL + launcher subscriber; **P3-b3/b4/b5/b6** keep hooks, no connecting churn, recreate after hard reject (`active`), deps at `main.js` bootstrap; SAVEPOINT unlink; CSP wss; ingest rollback mock tests (P3-c); **P3-m** intentional `process.exit(1)` on schema ensure fail-fast

## Post-merge / ops (carried from older owner trackers)

- **F1** (P0, from #163 / `AUDIT_OWNER_2026-10-02`): blob `init.full.sql` may still exist in `main` history — after merge, local Cursor only: history purge + rotate SMTP/DB passwords (HARD STOP: no filter-repo/BFG inside product PRs).
- **O3** (from #162 / `AUDIT_OWNER_2026-09-26`): after release install, CSP smoke — content icons, language flags, DevTools no `img-src` refusals for `cdn.modrinth.com` / `flagcdn.com`.

Do not merge until AR re-review + CI `Lint and Test` are green. Fix every AR finding in-PR (including former “non-blocking” P3).
