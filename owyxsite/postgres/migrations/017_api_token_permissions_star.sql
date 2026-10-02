-- F6: empty api_tokens.permissions used to mean "full admin" without checks.
-- New enforcement: only explicit ["*"] / "admin:all" is full access; [] is deny.
-- Migrate legacy empty/null rows to ["*"] so existing tokens keep working.

UPDATE public.api_tokens
SET permissions = '["*"]'::jsonb
WHERE permissions IS NULL
   OR permissions = 'null'::jsonb
   OR permissions = '[]'::jsonb
   OR (
     jsonb_typeof(permissions) = 'array'
     AND jsonb_array_length(permissions) = 0
   );
