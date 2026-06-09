# Дизайн: HTTP-эндпоинты для запуска кронных джобов

Дата: 2026-06-07
Ветка: feat/fact-checker (работа поверх неё)

## Цель

У бота уже поднимается HTTP-сервер ([src/index.ts](../../../src/index.ts)), который сейчас лишь
отвечает `ok`. Нужно повесить на него эндпоинты, через которые можно вручную/принудительно
запускать те же операции, что выполняют внутренние кроны. Параллельно — добавить pnpm-скрипты,
которые дёргают эти эндпоинты, и удалить старый CLI-способ (`manual-job`).

## Зафиксированные решения (из брейншторма)

1. **node-cron остаётся** внутри процесса как сейчас. Эндпоинты — дополнительный способ ручного
   запуска (замена `manual-job` CLI), расписание не трогаем.
2. **Гранулярность — обе**: для каждого джоба есть per-chat вариант (как старый manual-job) и
   all-chats вариант (как делают кроны).
3. **Без авторизации**: защита на сетевом уровне (только localhost / внутренняя сеть). В коде —
   никаких токенов.
4. **state-evolution /all = sweep** (точное зеркало крона: только чаты, которым пора), а не форс всех.
5. **Исполнение синхронное**: эндпоинт ждёт завершения и возвращает агрегированный результат.

## Каталог джобов

| Джоб | per-chat | all-chats |
|---|---|---|
| `topic-of-day` | `TopicOfDayScheduler.runNow(chatId)` | итерация approved-чатов → `runNow` каждому |
| `state-evolution` | `StateEvolutionPass.run(chatId)` (force) | `StateEvolutionScheduler.sweep()` (как крон) |
| `fact-check` | `FactCheckPipeline.runHourly(chatId)` | итерация approved → `runHourly` (= крон hourly) |
| `fact-check-stats` (period) | `FactCheckPipeline.runStats(chatId, period)` | итерация approved → `runStats` (= крон stats) |

`period ∈ { daily, weekly, monthly }`.

Асимметрия `state-evolution` сознательна: per-chat форсит один чат (поведение старого manual-job),
all-chats делает sweep (поведение крона — крон никогда не «форсит всех»).

## HTTP API

Транспорт — `node:http` + роутер `find-my-way` (radix-tree, тот же, что в Fastify). Все
джоб-эндпоинты — `POST`, тело — JSON.

```
GET  /health                              → 200 "ok"            (сохранить текущее поведение; используется Docker healthcheck)

POST /jobs/topic-of-day        { chatId }                       → per-chat
POST /jobs/topic-of-day/all                                     → все approved

POST /jobs/state-evolution     { chatId }                       → per-chat (force)
POST /jobs/state-evolution/all                                  → sweep

POST /jobs/fact-check          { chatId }                       → per-chat hourly
POST /jobs/fact-check/all                                       → все approved hourly

POST /jobs/fact-check-stats    { chatId, period }               → per-chat stats
POST /jobs/fact-check-stats/all { period }                      → все approved stats
```

### Формат ответа

- per-chat: переиспользует форму `JobRunResult` (бывш. `ManualJobRunResult`):
  `{ ok: true, job, chatId, outcome, ... }`.
- all-chats: агрегат `{ ok: true, job, scope: "all", totalChats, results: JobRunResult[] }`.
  Для `state-evolution/all` (sweep) результат — сводка sweep'а (число запрошенных прогонов), а не
  пер-чатовые `JobRunResult`, т.к. sweep работает через `worker.requestRun` (fire-and-forget внутри).

### Коды ошибок

- `400` — отсутствует/некорректен `chatId` (не integer) или `period` (не из множества).
- `404` — неизвестный путь.
- `405` — метод не `POST` (для джоб-путей).
- `500` — исключение во время исполнения джоба (тело: `{ ok: false, error }`).

Авторизации нет. Развёртывание обязано не публиковать порт наружу (см. раздел Docker).

## Структура кода (подход A: выделенный HTTP-модуль + унифицированный JobRunner)

Новая директория `src/view/http/` (рядом с `src/view/telegram/`):

- `HttpServer.ts` — интерфейс `HttpServer { start(): Promise<void>; stop(): Promise<void> }` + Symbol
  `HTTP_SERVER_ID`.
- `JobController.ts` — валидация (`chatId`/`period`, неизвестный джоб → 404) и диспатч в `JobRunner`,
  формирование ответа. Чистый `run(jobName, scope, body)` — тестируется без сокетов. Зависит от
  `JobRunner`. Тип `HttpResult` + символ `JOB_CONTROLLER_ID`.
- `NodeHttpServer.ts` — адаптер `node:http`: владеет роутером `find-my-way` (`lookup(req, res)` +
  `defaultRoute`, маршруты `GET /health`, `POST /jobs/:job`, `POST /jobs/:job/all`), читает тело,
  зовёт `JobController.run`, пишет ответ, слушает `process.env.PORT ?? 3000`. 405 отдаётся вручную
  (у find-my-way встроенного нет). Реализует `HttpServer`.

Изменения в существующем коде:

- **`JobRunner`** (переименование `ManualJobRunner` → `JobRunner`):
  - `src/application/interfaces/scheduler/ManualJobRunner.ts` → `JobRunner.ts`
    (интерфейс `JobRunner`, символ `JOB_RUNNER_ID`; типы `JobName`/`JobRunInput`/`JobRunResult`).
  - `src/application/use-cases/scheduler/DefaultManualJobRunner.ts` → `DefaultJobRunner.ts`.
  - Метод `run(input)` → `runForChat(input)` (поведение сохраняется).
  - Новый `runForAllChats(job, opts?)`:
    - `topic-of-day` / `fact-check` / `fact-check-stats`: получить approved-чаты через
      `ChatApprovalService.listAll()` → отфильтровать `status === 'approved'` → последовательно
      выполнить per-chat операцию → собрать `results[]`.
    - `state-evolution`: вызвать `StateEvolutionScheduler.sweep()` и вернуть сводку.
  - Новые зависимости в `DefaultJobRunner`: `ChatApprovalService`, `StateEvolutionScheduler`
    (через `LazyServiceIdentifier`, как в MainService, чтобы избежать циклов).
- **`DefaultFactCheckScheduler`**: его приватные `runHourlyForAllChats` / `runStatsForAllChats`
  делегируют в `JobRunner.runForAllChats(...)` — единый путь исполнения, без дублирования цикла
  «по всем approved». Регистрация кронов остаётся без изменений.
- **`src/index.ts`**: убрать inline `http.createServer`; брать `HttpServer` из контейнера,
  вызывать `start()`; в `shutdown` — `httpServer.stop()` + `main.stop()`.
- **`src/container/application.ts`**: зарегистрировать `HTTP_SERVER_ID`, `JOB_CONTROLLER_ID`,
  обновить привязку `JOB_RUNNER_ID`.

## Удаления (старый способ «другим способом»)

- Файл `src/manual-job.ts`.
- Запись `'manual-job': './src/manual-job.ts'` в [rsbuild.config.ts](../../../rsbuild.config.ts).
- pnpm-скрипты: `job`, `job:state-evolution`, `job:topic-of-day` (заменяются новыми, см. ниже).

`migrate` и `audio-worker` энтрипоинты не трогаем.

## Новые pnpm-скрипты + trigger-скрипт

`scripts/trigger-job.mjs` — кроссплатформенный (Node global `fetch`), запускается напрямую (как
существующий `scripts/pre-migrate.js`, не бандлится). Base URL: `JOBS_BASE_URL` или
`http://localhost:${PORT ?? 3000}`. Аргументы:

- позиционный: имя джоба (`topic-of-day` | `state-evolution` | `fact-check` | `fact-check-stats`)
- `--chat-id <n>` — per-chat; `--all` — all-chats (взаимоисключающие, один обязателен)
- `--period <daily|weekly|monthly>` — обязателен для `fact-check-stats`

Скрипт делает `POST` на нужный путь, печатает JSON-ответ, ставит ненулевой exit-code при не-2xx.

```jsonc
"job": "node scripts/trigger-job.mjs",
"job:topic-of-day": "node scripts/trigger-job.mjs topic-of-day",
"job:topic-of-day:all": "node scripts/trigger-job.mjs topic-of-day --all",
"job:state-evolution": "node scripts/trigger-job.mjs state-evolution",
"job:state-evolution:all": "node scripts/trigger-job.mjs state-evolution --all",
"job:fact-check": "node scripts/trigger-job.mjs fact-check",
"job:fact-check:all": "node scripts/trigger-job.mjs fact-check --all",
"job:fact-check-stats": "node scripts/trigger-job.mjs fact-check-stats",
"job:fact-check-stats:all": "node scripts/trigger-job.mjs fact-check-stats --all"
```

Использование: `pnpm job:fact-check --chat-id 123`,
`pnpm job:fact-check-stats --period weekly --all` (pnpm пробрасывает хвост аргументов в скрипт).

Важно: новые скрипты требуют **запущенного бота** (старый manual-job поднимал одноразовый контейнер
и исполнял джоб напрямую). Это прямое следствие выбранной архитектуры «эндпоинты на живом сервере».

## Docker / сеть

В [docker-compose.yml](../../../docker-compose.yml) изменить публикацию порта `app` на
`127.0.0.1:${PORT:-3000}:3000` — реализует выбор «только localhost». Внутриконтейнерный
healthcheck бьёт `http://127.0.0.1:3000` и не ломается.

## Тесты

- Переименовать/обновить `test/ManualJobRunner.test.ts` → под `JobRunner`; починить устаревшую
  сигнатуру (реальный раннер уже принимает 3-й аргумент — fact-check — а тест конструирует с двумя).
- Новые тесты:
  - `JobRunner.runForAllChats`: итерация только approved-чатов, агрегат результатов; для
    `state-evolution` — вызов `sweep()` и сводка.
  - `JobController` / роутер: коды 400 (плохой chatId/period), 404, 405; корректный парсинг тела;
    маппинг путь → вызов раннера.
  - (опц.) парсинг аргументов `trigger-job.mjs`.
- Убедиться, что `test/MainService.test.ts` не затронут (HTTP вынесен из MainService в отдельный
  сервис).

## Документация

- `.env.example` — добавить `JOBS_BASE_URL` (опционально), если решим вынести его в env.
- `CLAUDE.md` / README — раздел про эндпоинты джобов и новые pnpm-скрипты (с пометкой «требуется
  запущенный сервер»).

## Вне области

- Замена node-cron внешним планировщиком (отклонено в брейншторме).
- Авторизация/токены (отклонено — сетевая изоляция).
- Очередь/асинхронное исполнение all-chats (выбрано синхронное).
- Изменения audio-worker / migrate.
