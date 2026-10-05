# Owner findings 2026-10-03 (WIP tracker)

G1–G18 смержены в #164. E1/E2/P3 — PR `feat/e1-e2-p3-pack-reuse-update`.

- G1–G18 → ✅ FIXED (#164)
- E1 — reuse parent pack → ✅ duplicate + pack apply (content-store hardlinks; flag `owyx.reuseParentPack=1`)
- E2 — update server pack → ✅ ingest version + `pack_versions` + `pack_updated` + admin UI
- P3 — sha256 RAM → ✅ streaming `plugin:utils|owyx_sha256_file`
