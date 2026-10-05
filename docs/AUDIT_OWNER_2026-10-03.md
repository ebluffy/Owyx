# Owner findings 2026-10-03 (WIP tracker)

G1–G18 смержены в #164. E1/E2/P3 — PR #165 `feat/e1-e2-p3-pack-reuse-update`.

- G1–G18 → ✅ FIXED (#164)
- E1 — reuse parent pack → ✅ admin-device only (`owyx.packParentHint:<packId>`); orphan dup deleted; flag opt-in
- E2 — update server pack → ✅ content-addressed + txn + FOR UPDATE; safe rollback; 409; confirm + dismiss; seed `__unknown__`; schema ensure fails startup
- P3 — sha256 / socket / tests → ✅ streaming sha; ACL + launcher `pack_updated` subscriber; `planIngestFile` tests; unlink-before-ROLLBACK

Do not merge until CI `Lint and Test` is green. Mark this tracker fully ✅ after merge.
