# Прокачка инфраструктуры (oxc + pnpm + удаление husky) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить ESLint+Prettier на oxc-стек (oxlint+oxfmt), полностью убрать git-хуки (husky+lint-staged) и перейти с npm на pnpm.

**Architecture:** Один линтер (`oxlint`) + один форматтер (`oxfmt`), без type-aware линтинга. Проверки только в CI (никаких локальных git-хуков). Пакетный менеджер — pnpm с активацией через Corepack. Атомарные свопы инструментов (старый удаляется в той же задаче, где добавлен новый), чтобы `pnpm lint`/`pnpm format` всегда оставались рабочими.

**Tech Stack:** pnpm 10 (Corepack), oxlint, oxfmt, GitHub Actions, rsbuild/rspack/swc, sqlite3 (нативный), vitest.

**Спецификация:** [docs/superpowers/specs/2026-05-28-infra-oxc-pnpm-no-husky-design.md](../specs/2026-05-28-infra-oxc-pnpm-no-husky-design.md)

**Окружение:** Windows, PowerShell. Команды ниже даны в кросс-платформенном виде; для удаления файлов на Windows используйте `Remove-Item`.

**Конвенция коммитов:** каждый коммит завершается строкой-трейлером
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Порядок задач

1. Удалить git-хуки (husky + lint-staged) — **первой**, чтобы не блокировать коммиты.
2. Перейти на pnpm (включая одобрение build-скрипта sqlite3).
3. Обновить CI на pnpm.
4. Заменить ESLint на oxlint (атомарный своп).
5. Заменить Prettier на oxfmt + переформатировать репозиторий (отдельный коммит).
6. Обновить документацию.
7. Финальная валидация всей цепочки.

---

## Task 1: Удалить git-хуки (husky + lint-staged)

**Files:**
- Modify: `package.json` (удалить скрипт `prepare`, блок `lint-staged`, devDeps `husky` и `lint-staged`)
- Delete: вся папка `.husky/`
- Local git: снять `core.hooksPath`

- [ ] **Step 1: Снять hooksPath, который прописал husky**

Run:
```bash
git config --unset core.hooksPath
```
Expected: команда завершается без вывода (если ключа нет — выводит ошибку «key does not exist», это тоже ок).

- [ ] **Step 2: Удалить папку `.husky/`**

PowerShell:
```powershell
Remove-Item -Recurse -Force .husky
```
Expected: папка `.husky/` исчезает.

- [ ] **Step 3: Убрать `prepare` и `lint-staged` из `package.json`**

В `package.json` удалить строку скрипта:
```json
"prepare": "husky",
```
и весь блок верхнего уровня:
```json
"lint-staged": {
  "*.{ts,js,json,md}": [
    "eslint --fix",
    "prettier --write"
  ]
},
```

- [ ] **Step 4: Удалить зависимости husky и lint-staged**

Run (npm, т.к. на pnpm ещё не перешли):
```bash
npm remove husky lint-staged
```
Expected: `husky` и `lint-staged` исчезают из `devDependencies`, `package-lock.json` обновляется.

- [ ] **Step 5: Проверить, что хуков больше нет**

Run:
```bash
git config --get core.hooksPath
```
Expected: пустой вывод (ключ снят).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .husky
git commit -m "chore: remove husky and lint-staged git hooks"
```

---

## Task 2: Перейти на pnpm

**Files:**
- Modify: `package.json` (поле `packageManager`, блок `pnpm.onlyBuiltDependencies`)
- Delete: `package-lock.json`
- Create: `pnpm-lock.yaml`

- [ ] **Step 1: Включить Corepack**

Run:
```bash
corepack enable
```
Expected: завершается без ошибок.

- [ ] **Step 2: Удалить npm-lockfile**

PowerShell:
```powershell
Remove-Item -Force package-lock.json
```

- [ ] **Step 3: Закрепить pnpm и поставить зависимости (первый прогон)**

Run:
```bash
corepack use pnpm@latest
```
Expected: в `package.json` поле `packageManager` становится `"pnpm@10.x.y"` (конкретная версия), запускается установка, создаётся `pnpm-lock.yaml`.

**Важно:** в выводе установки pnpm покажет предупреждение вида
`Ignored build scripts: sqlite3 (и, возможно, другие). Run "pnpm approve-builds" ...`.
Запишите полный список проигнорированных пакетов — он нужен на Step 4.

- [ ] **Step 4: Разрешить build-скрипты нативным зависимостям**

В `package.json` добавить блок верхнего уровня (включить `sqlite3` и все имена из предупреждения Step 3):
```json
"pnpm": {
  "onlyBuiltDependencies": ["sqlite3"]
}
```

- [ ] **Step 5: Переустановить с одобренными build-скриптами**

Run:
```bash
pnpm install
```
Expected: установка проходит, предупреждения «Ignored build scripts» для перечисленных пакетов больше нет.

- [ ] **Step 6: Проверить сборку (подтверждает, что нативный sqlite3 собрался)**

Run:
```bash
pnpm build
```
Expected: rsbuild успешно собирает `dist/index.js` и `dist/migrate.js` без ошибок.

- [ ] **Step 7: Проверить тесты (подтверждает работу sqlite3 в рантайме)**

Run:
```bash
pnpm test:coverage
```
Expected: все тесты vitest проходят (PASS), отчёт покрытия формируется.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml package-lock.json
git commit -m "chore: migrate package manager from npm to pnpm"
```

---

## Task 3: Обновить CI на pnpm

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Переписать workflow под pnpm**

Заменить весь блок `jobs.test.steps` так, чтобы файл стал:
```yaml
name: CI

on:
  pull_request:
    branches: ['**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format
      - run: pnpm type:check
      - run: pnpm build
      - run: pnpm test:coverage
```
Примечания: `pnpm/action-setup@v4` берёт версию pnpm из поля `packageManager`; `--silent` убран (косметика npm, для pnpm не нужен).

- [ ] **Step 2: Проверить, что lockfile совместим с `--frozen-lockfile`**

Run:
```bash
pnpm install --frozen-lockfile
```
Expected: установка проходит без ошибки `ERR_PNPM_OUTDATED_LOCKFILE` (значит закоммиченный `pnpm-lock.yaml` актуален).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run pipeline with pnpm"
```

---

## Task 4: Заменить ESLint на oxlint (атомарный своп)

**Files:**
- Modify: `package.json` (скрипты `lint`/`lint:fix`, devDeps), добавить `oxlint`, убрать eslint-зависимости
- Create: `.oxlintrc.json`
- Delete: `eslint.config.cjs`, `.eslintrc.json`

- [ ] **Step 1: Установить oxlint**

Run:
```bash
pnpm add -D oxlint
```
Expected: `oxlint` появляется в `devDependencies`.

- [ ] **Step 2: Создать `.oxlintrc.json`**

Create `.oxlintrc.json`:
```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "import"],
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/explicit-function-return-type": "error",
    "no-unused-vars": [
      "error",
      {
        "args": "after-used",
        "argsIgnorePattern": "^_",
        "ignoreRestSiblings": true
      }
    ],
    "import/no-default-export": "error"
  },
  "ignorePatterns": [
    "dist/**",
    "coverage/**",
    "node_modules/**",
    "test/**",
    "vitest.config.ts",
    "rsbuild.config.ts",
    "scripts/**",
    ".oxlintrc.json"
  ]
}
```

- [ ] **Step 3: Переключить скрипты lint на oxlint**

В `package.json` заменить:
```json
"lint": "eslint . --ext .ts",
"lint:fix": "npm run lint -- --fix",
```
на:
```json
"lint": "oxlint",
"lint:fix": "oxlint --fix",
```

- [ ] **Step 4: Запустить oxlint и убедиться, что он стартует**

Run:
```bash
pnpm lint
```
Expected: oxlint выполняется и печатает сводку (`Found N warnings/errors`). Если в выводе есть строки `unknown rule: typescript/explicit-function-return-type` (или иное правило) — удалите это правило из `.oxlintrc.json` и повторите Step 4.

- [ ] **Step 5: Автофикс и триаж оставшихся нарушений**

Run:
```bash
pnpm lint:fix
```
Затем:
```bash
pnpm lint
```
Expected: после автофикса оставшиеся нарушения либо отсутствуют, либо являются осмысленными (исправьте код вручную). Цель — `pnpm lint` завершается с кодом 0.

- [ ] **Step 6: Удалить ESLint и его конфиги**

Run:
```bash
pnpm remove eslint @eslint/js @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-config-prettier eslint-import-resolver-typescript eslint-plugin-import eslint-plugin-simple-import-sort eslint-plugin-unused-imports
```
PowerShell:
```powershell
Remove-Item -Force eslint.config.cjs, .eslintrc.json
```
Expected: перечисленные пакеты исчезают из `devDependencies`; оба конфиг-файла удалены.

- [ ] **Step 7: Проверить, что линтинг по-прежнему зелёный**

Run:
```bash
pnpm lint
```
Expected: PASS (код 0), oxlint работает без eslint в дереве зависимостей.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .oxlintrc.json eslint.config.cjs .eslintrc.json
git commit -m "chore: replace eslint with oxlint"
```

---

## Task 5: Попытаться сохранить архитектурные границы слоёв

Цель — проверить, поддерживает ли oxlint `import/no-restricted-paths`, и сохранить enforcement чистой архитектуры, если да. Если правило не поддерживается — задача завершается без изменений (потеря зафиксирована в спецификации).

**Files:**
- Modify: `.oxlintrc.json` (условно — добавить правило `import/no-restricted-paths`)

- [ ] **Step 1: Добавить правило в `.oxlintrc.json`**

В объект `rules` добавить:
```json
"import/no-restricted-paths": [
  "error",
  {
    "zones": [
      { "target": "src/domain", "from": ["src/application", "src/infrastructure", "src/view"] },
      { "target": "src/application", "from": ["src/infrastructure", "src/view"] },
      { "target": "src/infrastructure", "from": ["src/view"] }
    ]
  }
]
```

- [ ] **Step 2: Запустить oxlint и проверить поддержку правила**

Run:
```bash
pnpm lint
```
Expected — один из двух исходов:
- **Поддерживается:** oxlint применяет правило (нарушений границ быть не должно, т.к. код уже соблюдает слои → PASS). Переходите к Step 3.
- **Не поддерживается:** в выводе строка `unknown rule: import/no-restricted-paths` или правило игнорируется. Тогда **откатите** изменение Step 1 (уберите блок), убедитесь `pnpm lint` зелёный — и **пропустите** Step 3 (коммитить нечего, задача закрыта).

- [ ] **Step 3: Commit (только если правило поддержано)**

```bash
git add .oxlintrc.json
git commit -m "chore: enforce clean-architecture layer boundaries via oxlint"
```

---

## Task 6: Заменить Prettier на oxfmt

**Files:**
- Modify: `package.json` (скрипты `format`/`format:fix`, devDeps), добавить `oxfmt`, убрать `prettier`
- Create: `.oxfmtrc.jsonc`
- Delete: `.prettierrc`, `.prettierignore`

- [ ] **Step 1: Установить oxfmt**

Run:
```bash
pnpm add -D oxfmt
```
Expected: `oxfmt` появляется в `devDependencies`.

- [ ] **Step 2: Создать `.oxfmtrc.jsonc`**

Create `.oxfmtrc.jsonc`:
```jsonc
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "singleQuote": true,
  "semi": true,
  "trailingComma": "es5",
  "printWidth": 80,
  "tabWidth": 2,
  "ignorePatterns": ["dist/**", "coverage/**", "node_modules/**"]
}
```

- [ ] **Step 3: Переключить скрипты format на oxfmt**

В `package.json` заменить:
```json
"format": "prettier --check .",
"format:fix": "prettier --write .",
```
на:
```json
"format": "oxfmt --check",
"format:fix": "oxfmt",
```

- [ ] **Step 4: Проверить, что oxfmt стартует в режиме проверки**

Run:
```bash
pnpm format
```
Expected: oxfmt выполняется и сообщает о файлах, требующих форматирования (ненулевой код — это ожидаемо до переформатирования).

- [ ] **Step 5: Удалить Prettier и его конфиги**

Run:
```bash
pnpm remove prettier
```
PowerShell:
```powershell
Remove-Item -Force .prettierrc, .prettierignore
```
Expected: `prettier` исчезает из `devDependencies`; оба файла удалены.

- [ ] **Step 6: Commit (своп инструмента, без переформатирования кода)**

```bash
git add package.json pnpm-lock.yaml .oxfmtrc.jsonc .prettierrc .prettierignore
git commit -m "chore: replace prettier with oxfmt"
```

- [ ] **Step 7: Переформатировать весь репозиторий oxfmt**

Run:
```bash
pnpm format:fix
```
Expected: oxfmt переписывает файлы под свой стиль (диф будет большим — это ожидаемо).

- [ ] **Step 8: Убедиться, что формат и линт зелёные после переформатирования**

Run:
```bash
pnpm format
```
Expected: PASS (код 0).

Run:
```bash
pnpm lint
```
Expected: PASS (oxlint не сломан переформатированием).

- [ ] **Step 9: Commit переформатирования (отдельным коммитом)**

```bash
git add -A
git commit -m "style: reformat codebase with oxfmt"
```

---

## Task 7: Обновить документацию

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Обновить раздел Code Quality в `CLAUDE.md`**

Заменить:
```markdown
- `npm run lint` - ESLint code checking
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Check Prettier formatting
- `npm run format:fix` - Auto-fix formatting
```
на:
```markdown
- `pnpm lint` - oxlint code checking
- `pnpm lint:fix` - Auto-fix linting issues
- `pnpm format` - Check oxfmt formatting
- `pnpm format:fix` - Auto-fix formatting
```

- [ ] **Step 2: Заменить остальные `npm run`/`npm` на `pnpm` в `CLAUDE.md`**

Во всех командах разделов Build/Run, Testing, Database заменить `npm run <x>` → `pnpm <x>` и `npm install` → `pnpm install`.

- [ ] **Step 3: Обновить Development Workflow / Pre-commit в `CLAUDE.md`**

Удалить пункты, относящиеся к husky/pre-commit:
```markdown
**Pre-commit:**

- Never skip Husky pre-commit hooks (avoid `--no-verify`)
- Run `npm run format:fix` to fix formatting before committing
- Update `.env.example` when environment variables change
```
Заменить на:
```markdown
**Pre-commit:**

- Git-хуков нет — все проверки выполняются в CI
- Перед коммитом прогоните `pnpm format:fix` и `pnpm lint:fix`
- Update `.env.example` when environment variables change
```
И в Build Process заменить строку:
```markdown
- Never commit `node_modules` or modify `package-lock.json` directly
```
на:
```markdown
- Never commit `node_modules` or modify `pnpm-lock.yaml` directly
```

- [ ] **Step 4: Обновить `README.md`**

Прочитать `README.md` целиком. Заменить все `npm run <x>` → `pnpm <x>`. Заменить заметку про husky (около стр. 90):
```markdown
Перед коммитом запускаются husky-проверки. Не используйте флаг `--no-verify`, чтобы не пропустить их.
```
на:
```markdown
Git-хуков нет: линт, формат, типы и тесты выполняются в CI на каждый pull request.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update tooling references to pnpm and oxc"
```

---

## Task 8: Финальная валидация

**Files:** нет изменений (только проверки).

- [ ] **Step 1: Чистая установка из lockfile**

Run:
```bash
pnpm install --frozen-lockfile
```
Expected: успех, lockfile актуален.

- [ ] **Step 2: Прогнать всю CI-цепочку локально**

Run по очереди:
```bash
pnpm lint
pnpm format
pnpm type:check
pnpm build
pnpm test:coverage
```
Expected: каждая команда завершается с кодом 0 (PASS).

- [ ] **Step 3: Убедиться, что следов старого тулинга не осталось**

Run:
```bash
git grep -nE "husky|lint-staged|eslint|prettier" -- ':!docs/**' ':!pnpm-lock.yaml'
```
Expected: пустой вывод (никаких упоминаний удалённых инструментов в коде/конфигах/доках, кроме истории/спеки в `docs/`).

- [ ] **Step 4: Проверить отсутствие npm-артефактов**

PowerShell:
```powershell
Test-Path package-lock.json; Test-Path .husky; Test-Path eslint.config.cjs; Test-Path .prettierrc
```
Expected: все четыре — `False`.

---

## Self-review заметки (для исполнителя)

- **Покрытие спеки:** Task 1 ↔ §3 (удаление хуков); Task 2 ↔ §5 (pnpm) + build-скрипты sqlite3; Task 3 ↔ §6 (CI); Task 4 ↔ §1 (oxlint) + §4 (deps/scripts/файлы eslint); Task 5 ↔ §1/§«Осознанные потери» (no-restricted-paths); Task 6 ↔ §2 (oxfmt) + §4 (deps/файлы prettier); Task 7 ↔ §7 (доки). Все разделы спеки покрыты.
- **Условные шаги:** Task 4 Step 4 и Task 5 Step 2 содержат явные ветки на случай неподдержанного правила — это не плейсхолдеры, а проверяемые развилки с конкретным действием.
- **Согласованность имён скриптов:** `lint`/`lint:fix`/`format`/`format:fix`/`type:check`/`build`/`test:coverage` используются единообразно в package.json, CI и доках.
