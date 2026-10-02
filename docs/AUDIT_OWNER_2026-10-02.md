# Owner findings 2026-10-02

Рабочий список багов пачки. Актуальный статус — в теле PR. Чиним коммитами в этом же PR.

Base: `main` @ `1961589`.

| ID | Баг | Sev | Статус |
|---|---|---|---|
| **F1** | `owyxsite/postgres/init.full.sql` убран из дерева + gitignore; stub `postgres/README.md` | **P0** | ✅ |
| **E3** | ACL SSO: `owyx_site_browser_login` + `_cancel` в `apps/app/build.rs` | **P1** | ✅ |
| **F2** | Миграция `013` создаёт friends-таблицы до ALTER; `016` для ACL/access_mode | **P1** | ✅ |
| **E1** | Логотип писем → PNG `icon-192.png` | P2 | ✅ |
| **F3** | CI mold: retry step при 5xx | P2 | ✅ |
| **F4** | `/me` allowBanned + root `serverAccess`/`accessReason`; бан ≠ тихий логаут | P2 | ✅ |
| **F5** | Friends 401 → `clearOwyxSiteSession` | P2 | ✅ |
| **F6** | `requireApiTokenPermission` на long-term admin routes | P2 | ✅ |
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

**F1 note:** файл убран из ветки; полная зачистка git-истории + ротация SMTP/паролей — на локали владельца после merge (без filter-repo в этом PR).

**Не баг:** Friends Join/Play `requiresAccount`; сессия на 5xx/network; SSO loopback+state; open redirect; CSP без PostHog/Sentry.

Версия лаунчера в этом PR **не** бампается (E3 hotfix → `0.11.1` локально после merge).
