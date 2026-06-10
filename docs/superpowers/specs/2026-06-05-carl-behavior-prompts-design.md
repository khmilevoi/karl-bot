# Carl: усиление промптов — контекст, живость, вес БД, реакции, истины

Дата: 2026-06-05
Статус: design (утверждён в брейнсторме, ждёт ревью спеки)
Подход: **Approach 2** — промпты + конфиг + лёгкий код.

> Примечание: этот файл — локальный рабочий артефакт. **Не коммитить** (`docs/superpowers/`
> в `.gitignore` по правилам репо). Это переопределяет дефолтный шаг скилла «commit the design doc».

---

## 1. Проблема и цели

Сейчас поведение Carl собирается тремя LLM-стадиями: **gate** → **decision** → **state
evolution**. Состояние из БД (personality, political, user-profiles, truths) подаётся в
промпт как сырые JSON-блобы с пассивными заголовками и читается моделью как фон, а не как
директива. Из-за этого:

1. Бот слабо «читает комнату» — отвечает на изолированное сообщение, а не на разговор.
2. Бот недостаточно «живой»; данные из БД мало меняют его поведение.
3. Реакции ставятся редко; гайд по эмодзи хорош по смыслам, но беден по «когда ставить».
4. Self-факты про личность/прошлое Carl **не всегда** попадают в БД (истины теряются).

### Цели

- **G1. Контекст.** Carl читает тред (кто кому, температура, спор/фон, прямое обращение
  vs фон) и сверяет summary с текущим батчем.
- **G2. Живость из состояния.** «Живость» = выраженность накопленного state. Пустой state →
  сдержанный Carl; богатый → яркий и опиниёзный. Это один рычаг, не два конкурирующих.
- **G3. Вес БД.** Состояние диктует тон, позицию и выбор эмодзи, а не просто «доступно как
  справка».
- **G4. Реакции чаще + «на комнату».** Carl кидает реакции и на чужие сообщения (не только
  адресованные ему), как живой участник.
- **G5. Углублённый гайд по эмодзи** в рамках текущего набора из 20.
- **G6. Интересный собеседник.** Эволюция выбирает развитие в сторону отчётливого
  характера и *местами* осознанно расходится с консенсусом чата (селективная острота).
- **G7. Надёжный захват истин.** Всё про личность/прошлое Carl стабильно попадает в БД.
- **G8. Понимание адресации и реплаев.** Carl чётко понимает, к кому обращается юзер, и
  видит, на какое сообщение отвечают. Обращение к Carl = только @username, имя или реплай на
  его сообщение; остальное — чужой разговор (на который можно реагировать, но не отвечать как
  на адресованное себе).

### Не-цели (YAGNI)

- Отдельный дешёвый «reaction-lane» (Approach 3) — отложено; добавим, только если объём
  decision-вызовов станет проблемой.
- Расширение палитры эмодзи за пределы текущих 20.
- Отдельный scheduled-проход только под истины.
- Крупные изменения модели хранения. (Допускается **одна аддитивная миграция** —
  `ADD COLUMN reply_to_message_id, reply_to_user_id` — для надёжного понимания реплаев, см.
  раздел H. Других схемных изменений messages-таблицы нет.)

---

## 2. Зафиксированные решения брейнсторма

| Вопрос | Решение |
| --- | --- |
| Объём изменений | Промпты + конфиг + лёгкий код |
| Живость vs вес БД на тонком state | **Живость растёт из state** (на пустом — сдержанно) |
| Реакции на чужие сообщения | **Да, «реагирует на комнату»** |
| Эмодзи | **Углубить гайд по текущим 20** (палитру не расширять) |
| Эволюция: контрарианство | **Селективная острота** (не рефлекторно, с аргументом) |
| Надёжность истин | **Live-fix промптом + страховка в эволюции** |
| Адресация и реплаи | **С миграцией** (захват reply target id/message_id + рендер + промпт) |

---

## 3. Карта архитектуры (как есть)

- `DefaultBehaviorPipeline.handleStoredMessage` → directTrigger идёт сразу в `decide`;
  иначе сообщение копится в `BehaviorGateBatcher`; на флаше → `processBatch` →
  `ai.evaluateGate`. Если `shouldDecide=false` → `ignored`. Иначе → `decide`.
- `decide` → `assembler.assemble` (грузит summary, personality, political, profiles,
  userPolitical, truths, recent+selected сообщения) → `ai.decideBehavior` →
  `validator.validate` → `executor.execute` → `patchApplicator.applyPatches` →
  `eventLogger.logDecision` → `evolutionTrigger.maybeSchedule`.
- `PromptDirector.createBehaviorDecisionPrompt` собирает: neutralCore → behaviorDecisionSystem
  → askSummary → personalityState → politicalState → userProfiles → userPoliticalProfiles →
  truths → behaviorMessages.
- Истины (`truth.*`) — **только** в `liveStatePatchSchema` (BehaviorDecision.statePatches).
  В `evolutionPatchSchema` истин нет.
- `DefaultStatePatchApplicator` уже умеет применять истины (`applyTruthPatch`/`applyTruthAdd`)
  в live-lane. `applyEvolutionPatches` — отдельный switch, у которого `default → reject`.
- `DefaultPatchPolicy.evaluate`: отклоняет любой патч с пустым `evidence.messageIds`; truth-
  патчи попадают в `default: accept` (по confidence не режутся).
- Набор эмодзи продублирован: `behavior_decision_system_prompt.md` (строка ~67) и
  `BehaviorConfig.ts` (`DEFAULT_BEHAVIOR_DECISION_VALIDATOR_CONFIG.allowedEmoji`).
- Приём сообщений: `DefaultMessageContextExtractor.extract` достаёт `replyText`,
  `replyUsername` (из `reply_to_message.from`, как **дисплей-имя**, не @handle), `quoteText`.
  `reply_to_message.message_id` и `from.id` **не захватываются**. `MessageFactory.fromUser`
  кладёт reply/quote в `StoredMessage`; `MessageFactory.fromUserContent` (ветка voice)
  **не** кладёт reply/quote (баг — голосовые теряют контекст ответа).
- Триггеры прямого ответа: `MentionTrigger` (`@botUsername` где угодно), `ReplyTrigger`
  (реплай на сообщение бота: `reply.from.username === botUsername`), `NameTrigger`
  (`^botName[,:\s]` — **только в начале** сообщения).
- `PromptBuilder.addBehaviorMessages` рендерит reply как `↳ ответ @{replyUsername}: "…"` и
  цитату как `❝ цитата: "…"`; **не различает** реплай-на-Carl и реплай-на-другого, нет
  привязки к `#N`. Идентичность бота (`messenger.bot.botInfo` id/username) в сборку промпта
  не пробрасывается.

---

## 4. Дизайн по компонентам

### A. Принципы (сквозные, в промптах)

В `neutral_core_prompt.md` и системных промптах закрепляем:

- **Emergent liveliness.** На пустом/тонком state Carl сдержан и краток (верно фразе
  «no fixed style at startup»); с накоплением personality/relationships он ярче, острее,
  разговорчивее. Энергия берётся из state, а не из generic-«будь живым».
- **State диктует, а не описывает.** Заголовки state-блоков из пассивных в директивные.
- **Отношения управляют тоном и эмодзи.**
- **Реакции — главный канал присутствия.**

### B. Вес БД: слой синтеза (ядро, лёгкий код)

**Новый чистый модуль** (предлагаемое имя: `src/application/prompts/BehaviorBrief.ts`),
экспортирующий чистую функцию:

```
buildBehaviorBrief(state: BehaviorPromptState, messages: BehaviorPromptMessage[]): string
```

Назначение: пре-дайджест state в короткий **директивный бриф**, который кладётся в промпт
**прямо перед** блоком сообщений (где внимание модели максимально).

Содержимое брифа:

- **Relationship cards** — по одной строке на каждого юзера, активного в этом батче
  (определяется по `userId` сообщений; matched к `state.profiles`/`state.userPolitical`):
  - формат-пример:
    `@oleg — affinity −2 · distance: mocking · trust: low · grudge: "слил дедлайн"
    → холодно и колко; одобрения не давай; reaction-уклон 🤡/👎/💀`
    `@anna — affinity +3 · distance: warm · интересы: музыка
    → тёплый, поддерживающий тон; reaction-уклон 🔥/🫶/🥹`
  - эмодзи-уклон выводится детерминированно из `preferredDistance`/`affinityScore`
    (тёплый → 🔥/🫶/🥹/❤️; нейтральный → 👀/🤔/🙏; холодный/mocking/hostile → 🤡/👎/💀/🫠).
- **Mood / stance brief** — 2–3 строки из `personality.speechStyle` (tone/humor/verbosity/
  formality), `political.compass` (эконом/соц + confidence), `recurringThemes`:
  - пример: `Сейчас ты: tone=саркастичный, humor=сухой, verbosity=short, formality=low.
    Компас: эконом −4 / соц −2 (увер. 0.6/0.4). Темы: крипта, дедлайны. Говори в этом
    голосе; в политике аргументируй с этих позиций сразу.`

Поведение на тонком state (G2): если профилей нет → строка
«Отношений пока нет — держись нейтрально и наблюдай»; если personality пустой → краткий
mood-бриф «характер ещё не сформирован». То есть бриф сам реализует emergent liveliness.

Источник истины не меняется: полные JSON-блоки остаются (для нюансов и truths), бриф их
**дополняет**, а не заменяет.

**Интеграция:**

- `PromptBuilder` — новый шаг `addBehaviorBrief(state, messages)` (по образцу существующих
  шагов; не пушит ничего, если бриф пустой/нерелевантный — но обычно непустой).
- `PromptDirector.createBehaviorDecisionPrompt` — вставить `addBehaviorBrief(...)` **после**
  state-блоков и **перед** `addBehaviorMessages(...)`.
- Заголовки шаблонов `personality_state_prompt.md`, `political_state_prompt.md`,
  `user_profiles_prompt.md`, `user_political_profiles_prompt.md`, `truths_prompt.md` —
  переписать из пассивных в директивные (например, «This is who you are right now — your
  replies must sound like this; this is not reference data, it is your current self»).

### C. Эволюция: «интересный голос» + селективная острота (G6, промпт)

Правки `state_evolution_system_prompt.md` (+ пара строк в `neutral_core` про самоощущение
«быть небанальным собеседником»):

- **Objective «interesting voice».** При прочих равных предпочитать развитие, дающее
  отчётливый характер (свои вкусы, повторяющиеся темы, узнаваемый юмор, запоминающиеся
  мнения) вместо размытой нейтральности.
- **Селективное расхождение с консенсусом.** Когда чат в ленивом единогласии, Carl
  *иногда* осознанно занимает меньшинственную/противоположную позицию, но:
  - только с **реальным аргументом** (интересно = обоснованно и неожиданно, не «назло»);
  - **не рефлекторно** («местами», а не на каждый консенсус); искренняя уже имеющаяся
    позиция важнее желания возразить;
  - оформляется как `politics.add_position` / `politics.adjust_position` с
    `origin: "bot_reflection"`, интенсивность по существующим правилам confidence.
- **Анти-скука-правило.** Явно: «всегда против всех» — это скучно и предсказуемо; цель —
  непредсказуемость и живость (и согласие, и расхождение в нужный момент).
- **Гардрейлы не ослабляются.** Контрарианство — про смелость мнений и масштаб желаемых
  изменений («radical does not mean violent»), НИКОГДА не про насилие/харассмент/
  дегуманизацию. Существующие safety-строки сохраняются дословно.

> Замечание по коду: `politics.add_position` в `applyEvolutionPatches` сейчас жёстко
> проставляет `origin: 'chat_discussion'`. Чтобы контрарианские позиции корректно
> помечались `bot_reflection`, нужно либо (а) различать origin по эвристике в аппликаторе,
> либо (б) добавить origin/флаг в патч-схему. Решение зафиксировать на этапе плана; для
> спеки достаточно, что промпт просит bot_reflection-позиции, а маркировку origin доводим
> в коде минимально (предпочтительно — необязательное поле в патче с дефолтом
> `chat_discussion`).

### D. Понимание контекста (G1, промпт)

В `behavior_decision_system_prompt.md` (и кратко в gate) — блок **«Read the room before
acting»**:

- кто кому отвечает (reply/quote-строки уже есть в формате сообщений), кто инициатор;
- эмоциональная температура треда; идёт ли спор; адресовано ли Carl напрямую или это фон;
- сверять `summary` («что было раньше») с батчем («что сейчас»), не отвечать в вакууме;
- source-метки `text`/`voice` уже объяснены — оставить как есть.

### E. Реакции: чаще + «на комнату» (G4)

- **Gate** (`behavior_gate_system_prompt.md`): явно прописать, что *достойный реакции
  момент у других* (смешно/база/кринж/драма) — уже повод для `shouldDecide=true`, а не
  только текстовый ответ. Добавить gate-reason `ambient_reaction` в
  `gateReasonSchema` (`src/domain/behavior/schemas/gate.ts`).
- **Response ladder** (`behavior_decision_system_prompt.md`): переписать так, что
  ambient-реакции на чужие сообщения — норма для живого участника; правило «не реагируй на
  каждое подряд» смягчить до «не спамь **одинаковой** реакцией подряд», сохранив высокую
  частоту. Сохранить, что ladder не глушит живые споры/прямые триггеры.
- **Эмодзи-уклон** реакций берётся из relationship card (раздел B) → реакции DB-driven (G3).
- **Config** (`BehaviorConfig.ts`):
  - `maxReactionsPerWindow`: 8 → ~20 (окно 60с) — конкретное число утвердить в плане.
  - Проверить `minDecisionConfidence` (0.45): где используется и не отбрасывает ли
    низко-«уверенные» чисто-реакционные решения; при необходимости понизить/исключить
    реакции из-под порога.
- **Tradeoff (зафиксирован):** больше `shouldDecide=true` = больше decision-вызовов
  (стоимость/латентность). Осознанная цена Approach 2; reaction-lane — на потом.

### F. Эмодзи: углублённый гайд по 20 (G5, промпт)

Таблицу смыслов сохранить, углубить по трём осям в `behavior_decision_system_prompt.md`:

- **Когда ставить что** — короткие триггеры «ситуация → эмодзи»
  (смешно до слёз → 💀/😭; кринж-тейк → 🤡/🫠; база → 🔥/👏; «расскажи ещё» → 👀;
  скепсис → 🤔; тёплая поддержка → 🫶/🥹).
- **Привязка к отношениям/настроению** — к тёплым 🫶/🥹/❤️; к холодным/grudge — 🤡/👎/💀;
  тон эмодзи следует mood-брифу.
- **Больше примеров + анти-бумер правило** (👍/😂/👏/🙏 заменять зумерской альтернативой,
  когда она есть). Набор 20 не меняем → синхронизация промпт↔валидатор не требуется.

### G. Надёжность истин (G7)

**Корневые причины потери истин:**
1. `DefaultPatchPolicy` отклоняет патч с пустым `evidence.messageIds`. Self-факт, который
   Carl произносит в **своём** ответе, ещё не сохранён → у модели нет валидного `#N`.
2. Захват связан с одним decision-вызовом (модель роняет бухгалтерию, сосредоточившись на
   реплике).
3. Эволюция не умеет эмитить истины (нет патч-типа).

**Live-fix (промпт, `behavior_decision_system_prompt.md`):**
- Жёсткий пошаговый чек-лист перед финализацией: «просканируй и входящие сообщения, и текст
  своего ответа на self-факт о Carl (прошлое/жизнь/origin/биографические вкусы); каждый
  такой факт ОБЯЗАН дать truth-патч в этом же ответе».
- Правило evidence: «для self-факта, который ты произносишь в ответе, evidence = id
  сообщения(й), которые тебя на это спровоцировали» → `messageIds` непустой, политика не
  режет.

**Страховка в эволюции (лёгкий код + промпт):**
- Схема: добавить truth-патчи в решение эволюции. Предпочтительно **отдельным полем**
  `truthPatches: TruthPatch[]` в `stateEvolutionDecisionSchema` (`evolution.ts`), а не
  смешивать с `evolutionPatches` (чище для типизации и применения).
- Применение: в `DefaultStateEvolutionPass.run` после `applyEvolutionPatches` вызвать
  применение truth-патчей через **существующий** `applyTruthPatch`/`applyTruthAdd`
  (вынести/переиспользовать; для эволюции рейт-лимит не применяем — проход медленный).
- Промпт эволюции: добавить ответственность «вымести self-факты Carl из недавних реплик и
  оформить `truth.add`/`reinforce`/`revise`», evidence = реальные сохранённые id (в
  эволюции уже доступны).
- **Проверить**, что контекст эволюции (`DefaultStateEvolutionContextAssembler`) содержит
  ассистентские сообщения Carl, иначе sweep не увидит его self-statements; при необходимости
  — расширить ассемблер.

### H. Понимание адресации и реплаев (G8)

Сочетает миграцию данных, рендер и промпт.

**Данные (аддитивная миграция):**
- Миграция `migrations/021_add_reply_target_fields.up.sql` / `.down.sql`:
  `ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER` и
  `ADD COLUMN reply_to_user_id INTEGER` (обе nullable; старые строки → NULL, это ок).
- `ChatMessage` / `StoredMessage`: добавить `replyToMessageId?: number`,
  `replyToUserId?: number`.
- `DefaultMessageContextExtractor.extract`: захватывать
  `reply_to_message.message_id` и `reply_to_message.from.id`.
- `MessageFactory.fromUser`: прокинуть новые поля. **`fromUserContent` (voice): прокинуть
  reply/quote И новые поля** (чинит баг потери reply-контекста у голосовых).
- `SQLiteMessageRepository`: добавить колонки в `INSERT`, в `SELECT_MESSAGE_COLUMNS` и в
  `rowToMessage`.

**Идентичность бота в контекст:**
- Пробросить self-identity (`{ id, username, name }`) в decision-контекст. Источник —
  `messenger.bot.botInfo` (id/username) + `envService.getBotName()` (имя). Положить в
  `BehaviorDecisionContext`/`BehaviorPromptContext` как `selfIdentity` (инъекция источника
  идентичности в `DefaultBehaviorContextAssembler` либо передача в `PromptDirector`).

**Производные флаги адресации (в ассемблере или чистом хелпере):**
Для каждого сообщения батча вычислить:
- `replyToSelf` — `replyToUserId === selfIdentity.id`.
- `addressedToSelf` — `replyToSelf` ИЛИ текст содержит `@{selfUsername}` ИЛИ имя бота.
- `replyTargetOrdinal` — если `replyToMessageId` совпадает с telegram `messageId` одного из
  контекстных сообщений, найти его `#N` через refMap (telegram id → stored id → ordinal).

**Рендер (`addBehaviorMessages`):**
- В заголовок сообщения добавить маркер адресации: `[to:you]` (addressedToSelf),
  `[to:@handle]` (реплай/обращение к другому), иначе `[to:room]`.
- Reply-строка:
  - на Carl → `↳ ОТВЕЧАЮТ ТЕБЕ (Carl)` + (если есть) `на #N`: `"…"`;
  - на другого → `↳ отвечает @{handle}` + (если есть) `на #N`: `"…"`;
  - использовать настоящий `@username` где он есть, дисплей-имя как фолбэк.
- Цитату оставить как `❝ цитата: "…"`.

**Промпт (`behavior_decision_system_prompt.md` + кратко в gate):**
- Явное **правило адресации**: «Сообщение адресовано ТЕБЕ только если: (а) содержит
  `@{твой_username}`, (б) содержит твоё имя как обращение, или (в) это реплай на твоё
  сообщение (маркер `[to:you]`). Всё прочее — разговор других: можешь отреагировать на
  комнату, но НЕ отвечай так, будто спросили тебя, и не приписывай чужие реплики себе».
- Велеть читать reply/quote-строки и `#N`-привязку, чтобы понимать, на что и кому отвечают.
- Сообщить Carl его собственные хэндлы (username + имя) — через mood-бриф или отдельную
  строку идентичности, чтобы он узнавал обращения к себе.

**Триггеры (опционально, вне ядра):** `NameTrigger` ловит имя только в начале строки.
Расширение на «имя где угодно» повышает отзывчивость, но рискует ложными срабатываниями на
упоминания в третьем лице («Карл вчера…»). Понимание адресации в любом случае обеспечивает
правило в decision-промпте; расширение триггера — отдельный опциональный пункт, решить в
плане.

### I. Тестирование и выкатка

- **Юнит-тесты** для `buildBehaviorBrief`: вход state+messages → ожидаемые строки; кейсы
  пустого/тонкого state; корректный эмодзи-уклон от distance/affinity; matching юзеров по
  батчу.
- **Снапшот/порядок промпта**: обновить `test/PromptDirector.test.ts` — `addBehaviorBrief`
  подключён в нужном месте (после state-блоков, перед сообщениями).
- **Схемы**: тест на новый gate-reason `ambient_reaction`; тест на `truthPatches` в
  `StateEvolutionDecision` (`test/behaviorJsonSchema.test.ts`).
- **Применение**: тест, что эволюция применяет truth-патчи через аппликатор (новый/в
  `test/...PatchApplicator`/evolution pass тестах).
- **Адресация/реплаи (H):**
  - `MessageContextExtractor` — захват `reply_to_message.message_id` и `from.id`.
  - `MessageFactory` — `fromUser` и `fromUserContent` прокидывают reply/quote + новые поля
    (регресс на баг голосовых).
  - `SQLiteMessageRepository` — round-trip новых колонок (insert→select→`rowToMessage`).
  - `PromptBuilderBehaviorMessages` — маркеры `[to:you]`/`[to:@handle]`/`[to:room]`,
    «ОТВЕЧАЮТ ТЕБЕ», привязка `на #N`.
  - Хелпер флагов адресации — `replyToSelf`/`addressedToSelf`/`replyTargetOrdinal`.
- **Ручная проверка** через `LOG_PROMPTS=1` — глазами увидеть бриф, маркеры адресации и
  порядок блоков в собранном промпте.
- **Команды:** `pnpm migration:up` (новая колоночная миграция) → `pnpm type:check` →
  `pnpm lint:fix` → `pnpm format:fix` → `pnpm test`.
- **Выкатка:** изменения аддитивные и обратносовместимые (новый шаг промпта, новое
  необязательное поле схемы, конфиг-числа, **одна аддитивная миграция** ADD COLUMN). Старые
  строки messages → NULL в новых колонках (Carl просто не получит reply-target для древних
  сообщений — деградация мягкая).

---

## 5. Затрагиваемые файлы (ориентир)

**Промпты:**
- `prompts/neutral_core_prompt.md` — принципы A, самоощущение «интересный собеседник».
- `prompts/behavior_decision_system_prompt.md` — read-the-room (D), ladder + ambient (E),
  углублённый эмодзи-гайд (F), live-fix истин (G).
- `prompts/behavior_gate_system_prompt.md` — ambient-реакции как повод (E).
- `prompts/state_evolution_system_prompt.md` — интересный голос + селективная острота (C),
  sweep истин (G).
- `prompts/personality_state_prompt.md`, `political_state_prompt.md`,
  `user_profiles_prompt.md`, `user_political_profiles_prompt.md`, `truths_prompt.md` —
  директивные заголовки (B).

**Код (лёгкий):**
- `src/application/prompts/BehaviorBrief.ts` — новый чистый модуль синтеза (B).
- `src/application/prompts/PromptBuilder.ts` — шаг `addBehaviorBrief` (B).
- `src/application/prompts/PromptDirector.ts` — вставка шага в decision-промпт (B).
- `src/domain/behavior/schemas/gate.ts` — reason `ambient_reaction` (E).
- `src/domain/behavior/schemas/evolution.ts` — поле `truthPatches` (G).
- `src/domain/behavior/schemas/patches.ts` — переиспользование `truthPatchSchema` для
  эволюции (G); опционально origin-поле для контрарианских позиций (C).
- `src/application/behavior/DefaultStatePatchApplicator.ts` — применение truth-патчей в
  эволюции через существующую логику (G); опционально origin для bot_reflection (C).
- `src/application/behavior/DefaultStateEvolutionPass.ts` — вызвать применение truthPatches
  (G).
- `src/application/behavior/BehaviorConfig.ts` — `maxReactionsPerWindow`, проверка
  `minDecisionConfidence` (E).
- `src/application/behavior/DefaultStateEvolutionContextAssembler.ts` — при необходимости
  включить ассистентские сообщения Carl (G).

**Адресация и реплаи (H):**
- `migrations/021_add_reply_target_fields.up.sql` / `.down.sql` — новые колонки.
- `src/domain/messages/ChatMessage.ts` — поля `replyToMessageId?`, `replyToUserId?`.
- `src/application/use-cases/messages/DefaultMessageContextExtractor.ts` — захват target id.
- `src/application/use-cases/messages/MessageFactory.ts` — прокидывание (вкл. фикс voice).
- `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts` — колонки в insert/
  select/`rowToMessage`.
- `src/application/behavior/DefaultBehaviorContextAssembler.ts` — `selfIdentity` + флаги
  адресации (или вынести в чистый хелпер).
- `src/application/prompts/PromptTypes.ts` / `BehaviorTypes.ts` — `selfIdentity`,
  производные флаги на сообщении.
- `src/application/prompts/PromptBuilder.ts` (`addBehaviorMessages`) + `PromptDirector.ts` —
  маркеры адресации, «ОТВЕЧАЮТ ТЕБЕ», `на #N`.

**Тесты:** `test/PromptDirector.test.ts`, новый тест `BehaviorBrief`,
`test/behaviorJsonSchema.test.ts`, тест применения эволюционных истин,
`test/MessageContextExtractor.test.ts`, `test/MessageFactory.test.ts`,
`test/PromptBuilderBehaviorMessages.test.ts`, тест репозитория сообщений.

---

## 6. Риски и смягчение

- **Стоимость decision-вызовов** растёт из-за ambient-реакций (E). Смягчение: батчинг уже
  есть; rate-limit реакций; при проблеме — Approach 3 позже.
- **Контрарианство выродится в «против всех»** (C). Смягчение: «селективная острота» +
  анти-скука-правило + требование реального аргумента.
- **Бриф уведёт от истины state** (B). Смягчение: бриф детерминирован, JSON остаётся
  источником; покрыт юнит-тестами.
- **origin-маркировка bot_reflection** требует аккуратности (C). Смягчение: минимальное
  необязательное поле с безопасным дефолтом; решить в плане.
- **Sweep истин в эволюции задвоит факты** (G). Смягчение: существующий dedup по эмбеддингам
  в `applyTruthAdd` работает и для эволюционных истин.
- **Миграция на named-volume / WAL (Windows)** (H). По памяти проекта БД на named volume
  `db-data`; миграция чисто аддитивная (`ADD COLUMN`, дёшево в SQLite, без переписывания
  таблицы). Смягчение: прогнать `pnpm migration:up`/`down` локально; `.down.sql` для отката.
- **`reply_username` остаётся дисплей-именем** (H). Не ломаем легаси-поле; для надёжной
  идентичности используем новый `reply_to_user_id`, а `@username` — из связанного контекстного
  сообщения, когда оно есть.

---

## 7. Критерии готовности

- Бриф (relationship cards + mood) виден в собранном decision-промпте (`LOG_PROMPTS`).
- State-заголовки директивные; на пустом state бриф даёт сдержанный режим.
- Gate пропускает ambient-моменты; Carl ставит реакции на чужие сообщения; эмодзи следуют
  отношениям/настроению.
- Эволюция способна занять обоснованную меньшинственную позицию (`bot_reflection`) и не
  делает это рефлекторно.
- Self-факты Carl стабильно появляются в truths (live + эволюционная страховка).
- Carl корректно отличает обращение к себе (@username/имя/реплай на своё сообщение) от
  чужого разговора; в промпте видны маркеры `[to:you]`/`[to:@handle]`/`[to:room]`,
  «ОТВЕЧАЮТ ТЕБЕ» и привязка `на #N`; голосовые больше не теряют reply-контекст.
- `pnpm migration:up` применяется чисто; `pnpm type:check && pnpm lint && pnpm test` зелёные.
