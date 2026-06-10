# Прокачка инфраструктуры: oxc + pnpm + удаление husky

**Дата:** 2026-05-28
**Статус:** дизайн утверждён, ожидает плана реализации

## Цель

Модернизировать инфраструктуру проекта по трём направлениям:

1. Заменить ESLint + Prettier на oxc-стек: `oxlint` (линтер) + `oxfmt` (форматтер).
2. Полностью убрать git-хуки (husky, lint-staged) — проверки остаются только в CI.
3. Перейти с npm на pnpm.

**Ведущий принцип — максимальное упрощение:** один линтер + один форматтер, без
type-aware линтинга, без второго инструмента-«добивки», без локальных git-хуков.

## Контекст (текущее состояние)

- **Линтинг:** ESLint flat config в `eslint.config.cjs` + легаси-стаб `.eslintrc.json`.
- **Формат:** Prettier, `.prettierrc` (`singleQuote`, `trailingComma: es5`, `semi`,
  `printWidth: 80`), `.prettierignore` (`node_modules`, `/dist`).
- **Хуки:** husky `pre-commit` → `lint-staged` (`eslint --fix` + `prettier --write`)
  + `npm run type:check` + `npm run test:coverage`; скрипт `prepare: husky`.
- **Пакетный менеджер:** npm (`packageManager: "npm@10.5.2"`, `package-lock.json`).
- **CI:** `.github/workflows/test.yml` отдельно гоняет `lint`, `format`, `type:check`,
  `build`, `test:coverage` на pull request.
- **Сборка:** `rsbuild` (rspack + swc), не зависит от eslint/prettier. Нативный модуль
  `sqlite3`. В `src/` используется alias `@/` (→ `src`).

## Решения (зафиксированы при брейншторме)

| Развилка | Выбор |
| --- | --- |
| Git-хуки | Полностью убрать (husky + lint-staged), проверки только в CI |
| Покрытие правил oxlint | Полный cutover: мапим всё, что oxlint поддерживает; непокрытое отбрасываем |
| Type-aware линтинг | Не включаем (без `oxlint-tsgolint`) |
| Пакетный менеджер | pnpm |

## Архитектура изменений

### 1. Линтинг → oxlint

- Добавить dev-зависимость `oxlint`.
- Сгенерировать `.oxlintrc.json` через `npx @oxlint/migrate ./eslint.config.cjs`,
  затем вычистить вручную.
- **Мапим** правила, которые oxlint поддерживает без type-aware:
  - `no-explicit-any`
  - `no-non-null-assertion`
  - `ban-ts-comment`
  - `no-unused-vars` (с `argsIgnorePattern: "^_"`)
  - `unused-imports` (неиспользуемые импорты)
  - `import/no-default-export`
  - `explicit-function-return-type`
- **Проверить на этапе реализации** и сохранить, если oxlint поддерживает:
  - `import/no-restricted-paths` (архитектурные границы слоёв) — высокая ценность,
    проверяем в первую очередь.
- `ignores`: `dist`, `coverage`, `node_modules`, `test`, `vitest.config.ts`,
  `rsbuild.config.ts`, `scripts`, конфиги oxc.
- Точный набор поддержанных правил подтверждается выводом `@oxlint/migrate` и
  сверкой с актуальной документацией oxlint.

### 2. Форматирование → oxfmt

- Добавить dev-зависимость `oxfmt`.
- Создать `.oxfmtrc.jsonc`:
  ```jsonc
  {
    "$schema": "./node_modules/oxfmt/configuration_schema.json",
    "singleQuote": true,
    "semi": true,
    "trailingComma": "es5",
    "printWidth": 80,
    "tabWidth": 2
  }
  ```
- **Следствие:** oxfmt — другой движок форматирования, чем Prettier, поэтому первый
  прогон `format:fix` переформатирует весь репозиторий. Делаем это **отдельным
  коммитом** (`style: reformat with oxfmt`), чтобы не смешивать с функциональными
  изменениями и сохранить читаемую историю.

### 3. Удаление хуков

- Удалить папку `.husky/` целиком.
- Удалить скрипт `prepare: husky` из `package.json`.
- Удалить блок `lint-staged` из `package.json`.
- Документировать ручной шаг для существующих локальных клонов:
  `git config --unset core.hooksPath` (husky прописывал его в `.git/config`).

### 4. package.json — скрипты и зависимости

- **Скрипты:**
  - `lint` → `oxlint`
  - `lint:fix` → `oxlint --fix`
  - `format` → `oxfmt --check .`
  - `format:fix` → `oxfmt .`
  - удалить `prepare`
- **Убрать из devDependencies:** `eslint`, `@eslint/js`, `@typescript-eslint/eslint-plugin`,
  `@typescript-eslint/parser`, `eslint-config-prettier`, `eslint-import-resolver-typescript`,
  `eslint-plugin-import`, `eslint-plugin-simple-import-sort`, `eslint-plugin-unused-imports`,
  `prettier`, `husky`, `lint-staged`.
- **Добавить в devDependencies:** `oxlint`, `oxfmt`.
- **Удалить файлы:** `eslint.config.cjs`, `.eslintrc.json`, `.prettierrc`,
  `.prettierignore`, `.husky/`.

### 5. Переход npm → pnpm

- `packageManager: "pnpm@10.x"` (последняя стабильная минорная версия на момент
  реализации), активация через Corepack — глобальная установка pnpm не требуется.
- Удалить `package-lock.json`, сгенерировать `pnpm-lock.yaml` (коммитится).
- **node-linker:** старт на дефолтном (строгий, изолированный, симлинки). Валидировать
  `build` (rsbuild/rspack/swc) и `test`. **Только если** что-то ломается из-за
  phantom-зависимостей — точечно добавить `public-hoist-pattern` в `.npmrc`
  (не глобальный `shamefully-hoist`). Нативный `sqlite3` устанавливается штатно.
- Имена скриптов в `package.json` не меняем; внутренние вызовы `node ...` остаются.

### 6. CI (`.github/workflows/test.yml`)

```yaml
- uses: actions/checkout@v4
- uses: pnpm/action-setup@v4          # берёт версию из packageManager
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'pnpm'
- run: pnpm install --frozen-lockfile
- run: pnpm lint        # oxlint
- run: pnpm format      # oxfmt --check
- run: pnpm type:check
- run: pnpm build
- run: pnpm test:coverage --silent
```

Экшены `checkout`/`setup-node` подтягиваются с v3 на v4 (требование свежего
`pnpm/action-setup@v4`). Структура шагов сохраняется.

### 7. Документация

- `CLAUDE.md`:
  - раздел Development Commands / Code Quality: `lint` = oxlint, `format` = oxfmt;
  - все `npm run X` → `pnpm X`;
  - убрать guidance про husky pre-commit (`Never skip Husky pre-commit hooks`);
  - в Development Workflow заметку про `package-lock.json` → `pnpm-lock.yaml`;
  - в Troubleshooting пересмотреть заметку про `npm config delete http-proxy`.
- `README.md`:
  - заменить заметку про husky pre-commit (стр. ~90) на «проверки выполняются в CI»;
  - команды `npm run X` → `pnpm X`.

## Осознанные потери enforcement (компромисс полного cutover)

Эти проверки уходят (если только oxlint не окажется их поддерживающим — см. §1):

- **Архитектурные границы слоёв** (`import/no-restricted-paths`) — domain/application/
  infrastructure/view больше не защищены автоматически (проверяем возможность сохранить).
- **Неиспользуемые/отсутствующие экспорты** (`import/no-unused-modules`).
- **Сортировка импортов** (`simple-import-sort`) — автофикс пропадает.
- **Порядок членов класса** (`member-ordering`).
- **type-aware правила:** `prefer-nullish-coalescing`, `prefer-optional-chain`,
  `consistent-type-imports`.

## Порядок реализации (фазы)

1. **pnpm:** `packageManager` + Corepack, удалить `package-lock.json`, `pnpm install`,
   обновить CI; прогнать `build` + `test` (зелёные).
2. **oxc-линтинг:** поставить `oxlint`, сгенерировать `.oxlintrc.json`, `pnpm lint:fix`.
3. **oxc-формат:** поставить `oxfmt`, `.oxfmtrc.jsonc`, отдельный коммит
   `style: reformat with oxfmt`.
4. **Удаление husky/eslint/prettier:** убрать зависимости, файлы конфигов, `.husky/`,
   `prepare`, `lint-staged`.
5. **Доки:** `CLAUDE.md`, `README.md`.
6. **Финальная валидация:** вся CI-цепочка локально зелёная
   (`pnpm lint && pnpm format && pnpm type:check && pnpm build && pnpm test:coverage`).

## Критерии готовности

- `pnpm install --frozen-lockfile` отрабатывает на чистом клоне; `pnpm-lock.yaml`
  закоммичен, `package-lock.json` удалён.
- `pnpm lint`, `pnpm format`, `pnpm type:check`, `pnpm build`, `pnpm test:coverage`
  проходят локально и в CI.
- В репозитории нет следов eslint/prettier/husky/lint-staged (ни в зависимостях,
  ни в конфигах, ни в `.husky/`).
- Документация (`CLAUDE.md`, `README.md`) описывает pnpm + oxc и не упоминает
  удалённые инструменты.
