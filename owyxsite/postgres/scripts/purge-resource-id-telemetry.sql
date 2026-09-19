-- One-shot cleanup for #134 telemetry flood:
-- "The resource id <uint32> is invalid."
--
-- On VPS (after review):
--   docker exec -i owyx-postgres psql -U owyx_user -d owyx_db \
--     < owyxsite/postgres/scripts/purge-resource-id-telemetry.sql
--
-- Safe to re-run. Does not touch non-matching rows.

BEGIN;

SELECT count(*) AS matching_before
FROM launcher_telemetry
WHERE message ~* '^The resource id [0-9]+ is invalid\.?$';

DELETE FROM launcher_telemetry
WHERE message ~* '^The resource id [0-9]+ is invalid\.?$';

COMMIT;
