# Owner findings 2026-10-02

База: `main` @ `1961589`. Актуальный статус — в теле PR.

| ID | Баг | Sev | Статус |
|---|---|---|---|
| **F1** | `init.full.sql` убран из дерева + gitignore; stub `postgres/README.md` | **P0** | ✅ tree (history+SMTP rotation → локально после merge) |
| **E3** | ACL SSO: `owyx_site_browser_login` + `_cancel` в `apps/app/build.rs` | **P1** | ✅ |
| **F2** | Миграция `013` создаёт friends-таблицы до ALTER; `016` для ACL/access_mode | **P1** | ✅ |
| **E1** | Логотип писем → PNG `icon-192.png` | P2 | ✅ |
| **F3** | CI mold: retry + fallback без mold при двойном 5xx | P2 | ✅ |
| **F4** | `/me` allowBanned + root `serverAccess`/`accessReason`; бан ≠ тихий логаут | P2 | ✅ |
| **F5** | Friends 401 → clear storage **и** Vue session via `onOwyxSiteSessionCleared` | P2 | ✅ |
| **F6** | Пустые permissions = deny; create пишет `["*"]`; миграция `017` | P2 | ✅ |
| **F7** | Turnstile не отключается client key на Site Host (+ жёстче rate на API Host) | P2 | ✅ |
| **F8** | Share tab скрыт; страница без Modrinth sign-in CTA | P2 | ✅ |
| **F9** | 7 ru-RU строк дописаны | P2 | ✅ |
| **F10** | Crowdin pull: skip без секретов (как push) | P2 | ✅ |
| **F11** | CI: `owyxsite/frontend` lint + build | P2 | ✅ |
| **F12** | Rate limit forum replies (5/час) | P2 | ✅ |
| **F13** | Миграция `016_friends_and_catalog_acl.sql` | P2 | ✅ |
| **E2** | Welcome-письмо без «гостю хватит ника» | P3 | ✅ |
| **F14** | Presence → имя из каталога, не `owyx-server:…` | P3 | ✅ |
| **F15** | Ошибки входа / access через i18n | P3 | ✅ |
| **F16** | Сокет чата: 20 msg/мин на пользователя | P3 | ✅ |
| **F17** | MC auth Display без сырого body | P3 | ✅ |

**F1 (честно):** файл убран из ветки / tracking / gitignore. Blob всё ещё в истории `main` до filter-repo. **Ротация SMTP/паролей + history purge — только локальный Cursor после merge** (HARD STOP: без filter-repo/BFG в этом PR).

**Не баг:** Friends Join/Play `requiresAccount`; сессия на 5xx/network; SSO loopback+state; open redirect; CSP без PostHog/Sentry.

Версия лаунчера в этом PR **не** бампается (E3 hotfix → `0.11.1` локально после merge).
