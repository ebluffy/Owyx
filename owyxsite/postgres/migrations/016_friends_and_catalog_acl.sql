-- Friends schema + catalog access_mode / ACL (F2/F13).
-- Idempotent. Safe on DBs that already got tables from ensure* JS or 013.
--
-- Fresh compose: mount after 015 (see docker-compose.yml).
-- Existing volume:
--   docker compose exec -T postgres psql -U owyx_user -d owyx_db < postgres/migrations/016_friends_and_catalog_acl.sql

CREATE TABLE IF NOT EXISTS public.friendships (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT friendships_no_self CHECK (user_id <> friend_id),
  CONSTRAINT friendships_pair_unique UNIQUE (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS friendships_user_status_idx
  ON public.friendships (user_id, status);

CREATE INDEX IF NOT EXISTS friendships_friend_status_idx
  ON public.friendships (friend_id, status);

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'offline'
    CHECK (status IN ('offline', 'online', 'playing')),
  instance_name TEXT,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.user_social_settings (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  allow_friend_requests BOOLEAN NOT NULL DEFAULT true,
  share_presence BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.user_social_settings
  ADD COLUMN IF NOT EXISTS share_presence BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'open';

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'open';

CREATE TABLE IF NOT EXISTS public.catalog_acl (
  id BIGSERIAL PRIMARY KEY,
  resource_type VARCHAR(16) NOT NULL CHECK (resource_type IN ('pack', 'server')),
  resource_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  effect VARCHAR(8) NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_acl_unique UNIQUE (resource_type, resource_id, user_id, effect)
);

CREATE INDEX IF NOT EXISTS catalog_acl_resource_idx
  ON public.catalog_acl (resource_type, resource_id);
