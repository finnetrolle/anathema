# Async Daily Brief

## 1. Цель фичи

`Async Daily Brief` превращает ежедневный статус-сбор из ручного ритуала в автоматическую сводку по изменениям за последние 24 часа и ожидаемым действиям на сегодня.

Фича должна отвечать на три вопроса:

1. Что реально изменилось со вчера.
2. Где есть риск молчаливого зависания или скрытого блокера.
3. Какие темы нужно вынести в живой дейлик, а какие можно закрыть асинхронно.

## 2. Business-value

- Сократить время на ежедневные синки команды и менеджера.
- Уменьшить количество “ложно-занятых” задач, которые числятся в работе без реального движения.
- Повысить прозрачность по ownership, handoff и блокерам.
- Дать менеджеру и TL короткий action-oriented digest вместо просмотра Jira вручную.

## 3. Основные пользователи

- Team Lead: хочет быстро понять, кого и по каким задачам надо отдельно спросить.
- Engineering Manager: хочет видеть статус команды без обязательного созвона.
- Разработчик: хочет один раз проверить, корректно ли система поняла его изменения.
- Product/Project Manager: хочет получить короткую сводку по delivery без чтения всей Jira-доски.

## 4. MVP-сценарии

### Сценарий A. Сводка для команды на утро

Пользователь открывает экран Daily Brief и видит:

- завершенные задачи за последние 24 часа;
- задачи, которые перешли в `In Progress`;
- задачи в работе без коммитов/PR;
- задачи с изменением исполнителя;
- задачи без due date или estimate;
- секцию “Topics for standup”.

### Сценарий B. Персональная сводка по человеку

Менеджер выбирает конкретного человека и видит:

- что он завершил;
- что у него в работе сейчас;
- что не двигается;
- где есть handoff или task churn.

### Сценарий C. Сводка по проекту

Менеджер выбирает проект и получает:

- ключевые изменения за сутки;
- новые риски;
- список задач, требующих внимания сегодня.

## 5. Границы MVP

### В MVP входит

- on-demand генерация brief внутри продукта;
- фильтры по проекту и человеку;
- временные окна `last 24h`, `since previous business day`, `custom`;
- классификация изменений по типам;
- секция “needs attention” с explainability;
- история сгенерированных brief-ов для повторного просмотра.

### В MVP не входит

- авто-доставка в Slack/Telegram/email;
- LLM-генерация свободного текста как единственный источник правды;
- персональные настройки времени рассылки;
- многоуровневые org-иерархии и ролевая модель доступа.

## 6. Данные и сигналы, уже доступные в проекте

Текущая база уже дает сильную основу:

- `Issue`, `Epic`, `Assignee`, `IssueStatusHistory`, `SyncRun` в [prisma/schema.prisma](/Users/finnetrolle/dev/anathema/prisma/schema.prisma:52)
- история назначений и observed people в [src/modules/timeline/load-dashboard.ts](/Users/finnetrolle/dev/anathema/src/modules/timeline/load-dashboard.ts:855)
- due dates, estimates, PR/commit signals в [src/modules/timeline/load-dashboard.ts](/Users/finnetrolle/dev/anathema/src/modules/timeline/load-dashboard.ts:920)
- UI-предупреждения про missing estimate / missing due date / no PR / no commits в [src/components/timeline/timeline-board.tsx](/Users/finnetrolle/dev/anathema/src/components/timeline/timeline-board.tsx:564)

### Сигналы для Daily Brief

- `completedYesterday`: задача завершена в выбранном окне;
- `startedYesterday`: задача впервые перешла в работу;
- `staleInProgress`: задача в работе, но без dev-активности;
- `ownershipChanged`: сменился assignee;
- `missingDueDate`: задача в работе без due date;
- `missingEstimate`: задача в работе без estimate;
- `doneWithoutPr`: задача завершена без PR-сигнала;
- `reopened`: задача вернулась из done в не-done.

## 7. Изменения в data model

### Новые сущности

- [ ] Добавить `DailyBriefRun`
  - `id`
  - `jiraConnectionId`
  - `projectId?`
  - `generatedForDate`
  - `windowStart`
  - `windowEnd`
  - `scopeType` (`TEAM`, `PERSON`, `PROJECT`)
  - `scopeKey`
  - `status`
  - `summaryJson`
  - `createdAt`

- [ ] Добавить `DailyBriefItem`
  - `id`
  - `dailyBriefRunId`
  - `issueId`
  - `itemType`
  - `importance`
  - `headline`
  - `detailsJson`
  - `createdAt`

- [ ] Добавить индексы по `generatedForDate`, `scopeType`, `scopeKey`

### Почему отдельные таблицы нужны

- brief должен быть воспроизводимым и ссылаться на конкретный набор данных;
- команде нужен audit trail “что система показала утром”;
- это упростит последующую доставку brief-а во внешние каналы.

## 8. Backend-план

### Этап 1. Подготовка доменной логики

- [ ] Создать модуль `src/modules/daily-brief/`
- [ ] Выделить типы:
  - `DailyBriefScope`
  - `DailyBriefWindow`
  - `DailyBriefItemType`
  - `DailyBriefSummary`
- [ ] Реализовать функцию загрузки кандидатов на brief из Prisma
- [ ] Реализовать derivation-слой, который строит brief item-ы из issue + history + raw payload

### Этап 2. Алгоритм сборки brief

- [ ] Реализовать правила детекции событий:
  - завершение за окно;
  - старт за окно;
  - смена assignee;
  - отсутствие dev-активности;
  - отсутствие estimate/due date;
  - reopen;
  - done without PR
- [ ] Добавить scoring важности:
  - high: overdue, reopened, stale critical work, ownership churn;
  - medium: missing estimate/due date, no dev activity;
  - low: informational changes
- [ ] Реализовать dedupe, чтобы одна задача не плодила 5 одинаковых алертов
- [ ] Реализовать агрегаты:
  - `completedCount`
  - `startedCount`
  - `attentionCount`
  - `ownershipChangesCount`
  - `peopleCovered`

### Этап 3. Persist + cache

- [ ] Сохранять готовый brief snapshot в БД
- [ ] Привязать генерацию brief к успешному `SyncRun`
- [ ] Добавить защиту от повторной генерации одного и того же brief-а для одинакового окна и scope

## 9. API-план

- [ ] Добавить `GET /api/daily-brief`
  - параметры: `scopeType`, `scopeKey`, `from`, `to`, `project`, `person`
  - режимы: `latest` и `regenerate=true`
- [ ] Добавить `POST /api/daily-brief/generate`
  - on-demand генерация
  - возврат summary + items + stats
- [ ] Добавить `GET /api/daily-brief/history`
  - список уже созданных brief-ов для выбранного scope

### API-ответ MVP

- headline summary;
- counters;
- sections:
  - `completed`
  - `started`
  - `needsAttention`
  - `ownershipChanges`
  - `topicsForStandup`

## 10. UI-план

### Экран

- [ ] Добавить отдельную страницу `/daily-brief`
- [ ] Добавить переключатель scope:
  - team
  - project
  - person
- [ ] Добавить выбор временного окна
- [ ] Добавить sticky summary header с counters

### Визуальные блоки

- [ ] Секция “Completed since last brief”
- [ ] Секция “Started / moved into progress”
- [ ] Секция “Needs attention”
- [ ] Секция “Ownership changes”
- [ ] Секция “Topics for standup”

### Drill-down

- [ ] Для каждой карточки показывать:
  - issue key / summary
  - assignee
  - component / epic
  - причина попадания в brief
  - link в Jira
- [ ] Добавить быстрые фильтры:
  - only actionable
  - only my items
  - only project

## 11. План задач по этапам

### Sprint 1. Foundation

- [ ] Подготовить Prisma schema и миграцию для brief tables
- [ ] Создать модуль `daily-brief`
- [ ] Реализовать выборку issue/historical events за окно
- [ ] Покрыть правила derivation unit-тестами

### Sprint 2. API + базовый UI

- [ ] Собрать `GET/POST` API
- [ ] Реализовать страницу `/daily-brief`
- [ ] Показать 4 основные секции без внешней доставки
- [ ] Добавить историю brief-ов

### Sprint 3. Actionability

- [ ] Добавить ranking / importance
- [ ] Добавить “Topics for standup”
- [ ] Добавить фильтры по человеку/проекту
- [ ] Подготовить hooks для будущей scheduled delivery

## 12. Тестирование

- [ ] Unit-тесты на правила детекции каждого brief item type
- [ ] Unit-тесты на дедупликацию и scoring
- [ ] Integration-тесты Prisma-загрузки и генерации brief-а
- [ ] Smoke-тест на route генерации brief-а после sync
- [ ] UI smoke-тест страницы brief-а с empty state и filled state

## 13. Метрики успеха

- время подготовки к дейлику у TL/EM;
- доля задач, обсужденных в живом созвоне после async brief;
- число stale in-progress задач;
- число задач без estimate/due date;
- open rate / usage rate brief-а;
- число ручных переходов из brief-а в Jira.

## 14. Риски и смягчение

### Риск: слишком шумный brief

- [ ] Ввести scoring и фильтры actionable-only
- [ ] Ограничить информационные секции по объему

### Риск: ложные выводы по dev-активности

- [ ] В UI показывать explainability, а не только флаг
- [ ] Не считать отсутствие PR абсолютным блокером

### Риск: brief станет второй Jira

- [ ] Держать фокус на изменениях и действиях, а не на полном списке задач

## 15. Definition of Done

- [ ] Brief можно сгенерировать для команды, проекта и человека
- [ ] Все основные item types поддерживаются и покрыты тестами
- [ ] Пользователь видит explainability для каждого алерта
- [ ] Brief сохраняется и доступен повторно
- [ ] UI показывает empty / loading / error / success states
- [ ] Генерация запускается после успешного sync без ручной подготовки данных

## 16. Следующий этап после MVP

- scheduled delivery в Slack/Telegram/email;
- LLM-слой для human-friendly narrative поверх структурного brief-а;
- сравнение brief day-over-day;
- персональные digest preferences.
