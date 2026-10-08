# Owyx — backlog / someday plan

Living list of deferred product work. Not a release checklist — pick items when ready.

**Updated:** 2026-10-06

---

## R2 pack storage (someday)

**Status:** deferred — infrastructure ready, product wiring not started.  
**Why later:** сейчас аплоады идут на VPS (`local_ingest` → `uploads/packs/`), `api.owyx.site` **DNS-only** (grey-cloud) — лимит Cloudflare Free ~100 MB больше не режет. R2 нужен как запасной/масштабируемый хостинг больших `.mrpack`, не как срочный фикс.

### Уже сделано (ops)

| Item | Detail |
|------|--------|
| Bucket | Cloudflare R2 `owyx-packs` (EEUR) |
| Free tier | 10 GB storage / 1M Class A / 10M Class B / egress free |
| Alerts | Budget ~$1; storage alert ≥ ~9 GB |
| Lifecycle | Abort incomplete multipart after 1 day |
| Card | Activated on CF account — keep alerts; empty bucket ≈ $0 |

### Когда реализовывать

Имеет смысл, если:

- диск VPS начинает упираться в большие паки, или
- хочется разгрузить origin от раздачи `.mrpack`, или
- нужен публичный/CDN URL для `http_zip` без хранения файла на API-хосте.

Ожидаемый объём (ориентир владельца): ~15 паков/мес, редко до ~2 GB один раз — **10 GB и Class A/B с запасом**.

### Что сделать в коде

1. **Upload path** — после ingest (или вместо локального файла) класть объект в `owyx-packs` (S3 API / `@aws-sdk/client-s3` с R2 endpoint). Credentials только из env на VPS — **не в git**.
2. **Catalog `source_config`** — URL на R2 (public custom domain или signed GET). Сохранить совместимость с `local_ingest` / `http_zip` для старых паков.
3. **Delete sync** — при `DELETE /packs/:id` (сайт + лаунчер → тот же admin API) удалять R2-объект, если `source_config` указывает на бакет. Сейчас unlink есть только для локальных `/uploads/packs/…`.
4. **Replace / update** — при новой сборке того же пака: upload нового объекта → обновить URL/sha256 → удалить старый ключ (избежать orphan blobs).
5. **ACL** — не открывать бакет «на весь мир» без нужды: либо private + short-lived signed URLs через API, либо public read только для catalog-allowed keys (как сейчас ACL на download route).
6. **Contract / docs** — обновить `owyxsite/LAUNCHER_SITE_CONTRACT.md` + заметку в `AGENTS.md`, если меняется формат `source`.
7. **Optional** — оставить grey-cloud на `api`; раздача крупных файлов с R2, API остаётся лёгким.

### Не делать сейчас

- Не переключать прод-ingest на R2 «на всякий случай».
- Не писать delete-R2 ветку, пока в каталоге нет R2 URL.
- Не полагаться на hard $0 spend lock у CF — только алерты + пустой бакет.

### Ссылки

- Bucket / account: CF dashboard → R2 → `owyx-packs`
- Текущий local delete: `owyxsite/backend/src/routes/catalog.js` (`packsAdmin.delete`)
- Ingest dir: `owyxsite/backend/uploads/packs`

---

## Other open notes

_(добавляй сюда следующие someday-пункты)_
