# Owner findings 2026-10-03 (WIP tracker)

G1–G18 смержены в #164. E1/E2/P3 — PR #165 `feat/e1-e2-p3-pack-reuse-update`.

- G1–G18 → ✅ FIXED (#164)
- E1 — reuse parent pack → ✅ admin-device only (`owyx.packParentHint:<packId>`); orphan dup deleted; flag opt-in
- E2 — update server pack → ✅ content-addressed + SAVEPOINT rollback + confirm; badge Update clears dismiss (session-scoped)
- P3 — sha256 / socket / tests → ✅ streaming sha; ACL + launcher subscriber; **P3-b3** keep session hooks until last unsubscribe; SAVEPOINT unlink; CSP wss; ingest rollback mock tests (P3-c)

Do not merge until AR re-review + CI `Lint and Test` are green.
