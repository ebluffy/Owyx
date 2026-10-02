-- One-time codes for browser → launcher SSO (O4).
-- Apply on existing volumes:
--   docker compose exec -T postgres psql -U owyx_user -d owyx_db < postgres/migrations/015_launcher_auth_codes.sql

CREATE TABLE IF NOT EXISTS public.launcher_auth_codes (
    code_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS launcher_auth_codes_expires_idx
    ON public.launcher_auth_codes (expires_at);
