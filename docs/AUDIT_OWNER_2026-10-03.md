# Owner findings 2026-10-03 (WIP tracker)

Рабочий список багов пачки. Актуальный статус — в теле PR. Чиним коммитами в этом же PR.

Base: `main` @ `3493c64` (v0.11.1).

- G1 — Owyx-аккаунт: «Применить» скин падает `reading 'slice'` (причина: normalize_skin_texture возвращает number[], а owyx-skin-upload.ts:42 берёт .buffer.slice). Статус: open.
- G2 — Windows: bulk_update_content падает с os error 1314 (нет права на симлинк); recovery.rs::copy_symlink без fallback. Статус: open.
- G3 — Обновление модов: бэкап всей папки сборки (миры и т.д.) без прогресса, диск 244 МБ/с. recovery.rs::copy_directory. Статус: open.
- G4 — ProgressBar: голубые точки/артефакты (гипотеза: анимация left/width + mask ::after). Статус: open.
- G5 — Пауза/отмена задачи обновления: кнопки показаны при can_pause/can_cancel=false (откат), ошибки Install job cannot be paused/canceled. Статус: open.
- G6 — bulk update: «Selected content is no longer installed» после долгого бэкапа (проверка выбора поздно). Статус: open.
- G7 — Лог: спам ERROR load_snapshot os error 2 (game-locales). Статус: open.
- G8 — client key обходит Turnstile на API Host (auth.js:545-573). P2, open.
- G9 — rate limit в памяти процесса (ipRateLimit.js). P3, open.
- G10 — site_session.json без Windows ACL (utils.rs:43-80). P3, open.
- G11 — широкий Tauri FS scope $DOCUMENT/** (plugins.json). P3, hypothesis.
- G12 — Socket.IO не проверяет сессию после подключения (socket/index.ts). P2, open.
- G13 — reset-токен не атомарен (auth.js:1170-1196). P3, open.
- G14 — cropData.scale без лимитов (profile.js:409). P3, open.
- G15 — CurseForge NeoForge -> Vanilla (curseforge.rs:100-114). P2, open.
- G16 — process.rs::wait_for держит DashMap-lock. P3, open.
- G17 — npm audit backend (sharp 0.35.3 и др.). P2, open.
