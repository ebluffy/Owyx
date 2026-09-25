# CI Playbook & Troubleshooting — Owyx Monorepo

Памятка по устройству, частым ошибкам и быстрой починке CI-пайплайнов (`CI` / `turbo-ci.yml`, `check-generic.yml`, `check-rust.yml`, `i18n-push.yml`).

---

## 1. Структура workflows

| Workflow | Файл | Что делает | Где падает чаще всего |
|---|---|---|---|
| **CI (Turbo CI)** | `.github/workflows/turbo-ci.yml` | Build app frontend, owyxsite backend test, turbo lint & test, intl:extract check | ESLint (`simple-import-sort`), Vue SFC syntax, intl locale diff, Docker healthcheck |
| **Check Generic** | `.github/workflows/check-generic.yml` | `typos`, `tombi` (TOML linter) | Опечатки в коде/доках, синтаксис `tauri.conf.json` / `Cargo.toml` |
| **Check Rust** | `.github/workflows/check-rust.yml` | `cargo shear` (проверка неиспользуемых зависимостей), Clippy | Неиспользуемые crates в `Cargo.toml`, clippy warnings (`-Dwarnings`) |
| **Crowdin Push** | `.github/workflows/i18n-push.yml` | Синхронизация строк с Crowdin | Падал на форках из-за отсутствия токенов (закрыто через `if: env.CROWDIN_PROJECT_ID != ''`) |

---

## 2. Частые причины падения CI ("красный пайплайн") и как чинить

### 2.1. Ошибка линтера: `simple-import-sort/imports`
* **Симптом:**
  ```
  apps/app-frontend/src/...: error Run autofix to sort these imports! simple-import-sort/imports
  ```
* **Причина:** ESLint строго требует алфавитного порядка импортов и раздельного импорта типов (`type Ref, ref`).
* **Как починить наперед перед коммитом:**
  ```bash
  corepack pnpm --filter @modrinth/app-frontend exec eslint --fix <путь/к/файлу>
  corepack pnpm --filter @modrinth/app-frontend exec prettier --write <путь/к/файлу>
  ```

### 2.2. Синтаксис Vue SFC: `SyntaxError: [vue/compiler-sfc] Missing semicolon`
* **Симптом:**
  ```
  [plugin vite:vue] apps/app-frontend/src/App.vue: SyntaxError: [vue/compiler-sfc] Missing semicolon
  let lastError: unknown = null
  ```
* **Причина:** В `<script setup>` **без** `lang="ts"` Vite парсит блок как обычный JavaScript. Любые аннотации типов TypeScript приводят к падению сборки.
* **Как починить:**
  - Если компонент без `lang="ts"`: не использовать TS-аннотации (`let lastError = null`).
  - Либо явно перевести компонент на `<script setup lang="ts">`.
  - Проверить сборку локально: `corepack pnpm --filter @modrinth/app-frontend run build`.

### 2.3. Рассинхрон i18n локалей: `Verify intl:extract has been run`
* **Симптом:**
  ```
  git diff --exit-code --color */*/src/locales/*/index.json
  ```
* **Причина:** Добавлены новые строки через `defineMessages` / `formatMessage`, но не запущен экстрактор ключей локализации.
* **Как починить:**
  ```bash
  pnpm turbo run intl:extract --force
  pnpm scripts i18n-icu-contract prune-local --check
  ```
  *Примечание для Windows/Node 22:* скрипты в `scripts/*.ts` в CI запускаются через Node 24 (`.nvmrc`). Локально на Node 22 запускать с `--experimental-strip-types`.

### 2.4. ClickHouse / Labrinth Docker Services на форках
* **Симптом:**
  `labrinth-clickhouse is unhealthy` в шаге `docker compose up --wait`.
* **Причина:** На форках GitHub Actions (`ubuntu-latest`) нет кэша Namespace. При cache miss запускается полный стек Labrinth.
* **Как починено / не триггерить:**
  - Шаг в `turbo-ci.yml` запускает Docker только если `check-labrinth` определяет необходимость тестов Labrinth (`needs_services == true`).
  - При коммитах, затрагивающих только launcher / site / docs, Labrinth не тестируется и Docker не поднимается.

### 2.5. Тесты Owyx Backend (`Check Owyx backend`)
* **Симптом:**
  `npm ci && npm run typecheck && npm test` в директории `owyxsite/backend` завершается с ошибкой.
* **Как проверить перед коммитом:**
  ```bash
  cd owyxsite/backend
  npm run typecheck
  npm test
  ```

### 2.6. Ошибки Prettier в app-frontend (`prettier --check .`) и CRLF на Windows
* **Симптом:**
  ```
  Checking formatting...
  [warn] src/pages/OwyxServers.vue
  [warn] Code style issues found in the above file. Run Prettier with --write to fix.
  ELIFECYCLE Command failed with exit code 1.
  Failed: @modrinth/app-frontend#lint
  ```
* **Причина:** В `apps/app-frontend` скрипт `"lint"` выполняет `eslint . && prettier --check .`. Если хотя бы один файл форматирован не по стандарту Prettier (например, длинная строка не разбита) или переводы строк на Windows сконвертированы в CRLF (`core.autocrlf = true`), CI сразу падает.
* **Как починить:**
  Всегда запускать `corepack pnpm --filter @modrinth/app-frontend exec prettier --write <измененный_файл>`. В репозитории файлы должны сохраняться с `LF`. Перед коммитом проверять измененные файлы через `prettier --check`.

### 2.7. Clippy предупреждения как ошибки (`RUSTFLAGS: -Dwarnings`)
* **Симптом:**
  `cargo clippy` падает на предупреждениях (например, `sort_by` вместо `sort_by_key`).
* **Как предотвратить:**
  Не коммитить код на Rust с warning'ами. Запускать `cargo clippy --workspace --all-targets` и `cargo shear`.

---

## 3. Чеклист перед каждым коммитом / пушем

1. **Если правились `.vue` / `.ts` файлы во фронтенде:**
   - [ ] Запустить `corepack pnpm --filter @modrinth/app-frontend exec eslint --fix <измененный_файл>`.
   - [ ] Запустить `corepack pnpm --filter @modrinth/app-frontend exec prettier --write <измененный_файл>`.
   - [ ] Проверить, что нет аннотаций типов в `<script setup>` без `lang="ts"`.
2. **Если правился `owyxsite/backend`:**
   - [ ] Запустить `npm run typecheck && npm test` в `owyxsite/backend`.
3. **Если правился Rust код (`apps/app`, `packages/app-lib`):**
   - [ ] Проверить `cargo shear` (нет лишних crates).
   - [ ] Убедиться в отсутствии clippy warnings.
4. **Если добавлялись UI-строки:**
   - [ ] Убедиться в наличии переводов / ключей в `ru-RU/index.json` и `en-US/index.json`.
