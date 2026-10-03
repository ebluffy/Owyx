# Owyx Postgres

Bring up an **empty** database. Do **not** commit full `pg_dump` files
(`init.full.sql` and `*.full.sql` are gitignored — they can contain emails,
password hashes, and SMTP secrets).

## Fresh local compose

```bash
cd owyxsite
# optional: start from a clean volume
docker compose down
rm -rf postgres/data

docker compose up -d postgres
# First boot runs docker-entrypoint-initdb.d in order:
#   000_bootstrap_roles → init.sql → migrations 001…016
```

`init.sql` is the schema dump (no production rows). Migrations add chat,
cosmetics, catalog, friends, launcher auth codes, ACL, etc.

## Existing volume

`initdb.d` runs only on first create. Apply new SQL by hand:

```bash
docker compose exec -T postgres psql -U owyx_user -d owyx_db \
  < postgres/migrations/016_friends_and_catalog_acl.sql
```

## Production

Use migrations only (or restore a private backup kept outside git). Rotate SMTP
and user passwords if a dump was ever committed historically.
