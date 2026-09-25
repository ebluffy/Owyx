# Draft: owner findings + quick audit tracker

**Не fix-PR.** Только инвентарь багов. Фиксы — отдельными PR.  
Владелец докидывает находки → обновляем **только тело этого PR** (без лишних коммитов/комментов).

База прогона: `main` @ `13fd4bf1665162d15a4d03b436599586da2cee2c` · без Cursor Cloud · 2026-09-26.

---

## Owner findings

### O1 — Флаги языков в настройках не грузятся · **P1**
- **Симптом:** в селекторе языка (Стандартные: English / Русский / Deutsch / …) слева пустое место, иконок флагов нет.
- **Evidence:**
  - UI: `packages/ui/src/components/settings/language-settings/LanguageSettingsSelector.vue` → `getFlagUrl()` отдаёт `https://flagcdn.com/{region}.svg`, в шаблоне `<img :src="loc.flagUrl">`.
  - CSP Tauri: `apps/app/src-tauri/tauri.conf.json` → `csp.img-src` = `'self' asset: … textures.minecraft.net … owyx.site … githubusercontent … blob: data:` — **`flagcdn.com` нет**.
- **Root:** webview блокирует внешние SVG флагов по CSP (не «битый ассет» в репо — ассетов флагов в дереве нет, только CDN).
- **Fix direction:** добавить `https://flagcdn.com` в `img-src` **или** завести локальные флаги в `packages/assets` и не ходить в сеть.

### O2 — Сессия лаунчера быстро «отваливается» · **P2 / ops**
- **Симптом:** сессия Owyx (сайт/аккаунт в лаунчере) истекает слишком быстро; возможно связано с редеплоем на VPS.
- **Evidence:**
  - JWT + строка в `user_sessions` с `expires_at > NOW()` и `is_active` (`owyxsite/backend/src/routes/auth.js`).
  - Логин: без `remember` → JWT/`expires_at` **24h**; с `remember` → **30d**. Refresh-ветка тоже около **24h**.
  - Конфиг `tokenExpiration: "7d"` в `settings.js` **не** тот TTL, что реально ставит login (`remember ? 30d : 24h`).
  - Сессия лаунчера в OS-файле (`owyx_site_session_*`), не в webview localStorage (`apps/app-frontend/src/helpers/owyx-site-auth.ts`).
- **Вердикт:**
  - Если без «запомнить» — 24h это by design, не баг продукта.
  - Если после **редеплоя VPS** (новый `JWT_SECRET`, wipe Postgres/`user_sessions`, recreate volume) — все сессии дохнут сразу → **ops/expected**, не блокер продукта.
  - Если при живой БД/том же секрете выкидывает за минуты — тогда уже баг (искать 401 на `/me`, epoch clear, ротацию сессий). Нужен лог/тайминг от владельца.

---

## Audit findings (quick pass 2026-09-26)

### A1 — CSP `img-src` без `flagcdn.com` · **P1** (= root O1)
См. O1. Подтверждено чтением `tauri.conf.json` на `main`.

### A2 — Расхождение TTL сессии: settings `7d` vs login `24h`/`30d` · **P2**
`owyxsite/backend/src/config/settings.js` пишет `security.tokenExpiration: "7d"`, login hardcode `remember ? '30d' : '24h'`. Путаница для ops и для ожиданий «неделя».

### A3 — Документальный residual (не блокер merge других PR)
Инвентарь #141 закрыт по коду на момент прошлого LGTM; этот draft — **новый** трекер пост-merge находок владельца.

---

## Convention
- Этот PR = **draft tracker**. Не merge как fix.
- Fix-PR: правь код + `Closes` только на реально починенное Issue (если заведём).
- Обновления списка — **только edit body** этого PR.