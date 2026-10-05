-- Pack version history for «Обновить сборку сервера» (E2).
-- Apply on VPS when upgrading:
--   docker compose exec -T postgres psql -U owyx_user -d owyx_db < postgres/migrations/018_pack_versions.sql
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.pack_versions (
    id BIGSERIAL PRIMARY KEY,
    pack_id TEXT NOT NULL REFERENCES public.packs(id) ON DELETE CASCADE,
    version VARCHAR(64) NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    sha256 VARCHAR(64),
    file_size BIGINT,
    source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    UNIQUE (pack_id, version)
);

CREATE INDEX IF NOT EXISTS pack_versions_pack_id_created_idx
    ON public.pack_versions (pack_id, created_at DESC);

-- Optional bind: which library instance last published this pack (launcher-side id).
ALTER TABLE public.packs
    ADD COLUMN IF NOT EXISTS source_instance_hint TEXT;

ALTER TABLE public.packs
    ADD COLUMN IF NOT EXISTS latest_version VARCHAR(64);

COMMENT ON TABLE public.pack_versions IS
    'Owyx E2: published pack revisions with changelog; apply on VPS only.';
