# Owner findings 2026-10-03 (WIP tracker)

Рабочий список багов пачки. Актуальный статус — в теле PR. Чиним коммитами в этом же PR.

Base: `main` @ `3493c64` (v0.11.1).

- G1 — Owyx-аккаунт: «Применить» скин падает `reading 'slice'` (причина: normalize_skin_texture возвращает number[], а owyx-skin-upload.ts:42 берёт .buffer.slice). Статус: open.
- G2 — Windows: bulk_update_content падает с os error 1314 (нет права на симлинк); recovery.rs::copy_symlink без fallback. Статус: open.
