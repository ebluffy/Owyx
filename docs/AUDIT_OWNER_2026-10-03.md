# Owner findings 2026-10-03 (WIP tracker)

G1–G18 смержены в #164. E1/E2/P3 — PR #165 `feat/e1-e2-p3-pack-reuse-update`.

- G1–G18 → ✅ FIXED (#164)
- E1 — reuse parent pack → 🟡 admin-device only via `owyx.packParentHint:<packId>` (not public `sourceInstanceHint`); orphan dup deleted; flag still opt-in
- E2 — update server pack → 🟡 content-addressed + txn + FOR UPDATE; rollback never deletes live file; 409; confirm; seed `__unknown__`; schema ensure fails startup
- P3 — sha256 RAM → ✅ streaming + path allowlist tests; ACL broadcast; typos fixed

Do not mark E1/E2 ✅ until AR on #165 is APPROVED and CI green.
