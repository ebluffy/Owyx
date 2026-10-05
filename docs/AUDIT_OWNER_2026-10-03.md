# Owner findings 2026-10-03 (WIP tracker)

G1–G18 смержены в #164. E1/E2/P3 — PR #165 `feat/e1-e2-p3-pack-reuse-update`.

- G1–G18 → ✅ FIXED (#164)
- E1 — reuse parent pack → 🟡 AR fixes: match only `sourceInstanceHint` (not MC+loader); delete orphan dup on failure; still opt-in `owyx.reuseParentPack=1`
- E2 — update server pack → 🟡 AR fixes: ensureCatalogSchema 018 columns; content-addressed files + txn; 409 on version clash; confirm before Play update; seed pack meta + reactive badge; admin update list filters ingestible types
- P3 — sha256 RAM → ✅ streaming `plugin:utils|owyx_sha256_file` (+ create_dir_all before canonicalize; ACL-aware `pack_updated`; unit tests)

Do not mark E1/E2 ✅ until AR on #165 is APPROVED and CI green.
