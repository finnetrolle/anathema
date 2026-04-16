# Flow Bottleneck Analytics

## 1. Цель фичи

`Flow Bottleneck Analytics` должен показать, где работа замедляется внутри delivery-потока: в разработке, review, QA, handoff, ожидании или rework.

Фича должна отвечать на вопросы:

1. Где у нас узкое место в процессе.
2. Сколько времени работа проводит в value-adding стадии, а сколько в ожидании.
3. Какие компоненты, проекты или люди системно тормозят поток.
4. Где процесс ломается из-за rework и churn.

## 2. Business-value

- Ускорить delivery без увеличения headcount.
- Найти системные bottleneck-ы в review/QA/handoff, а не спорить по ощущениям.
- Повысить flow efficiency и predictability.
- Дать руководству факты для улучшения процесса, а не только статусы.

## 3. Основные пользователи

- Head of Engineering / EM: нужен системный взгляд на поток работы.
- Team Lead: нужен разрез по компонентам и этапам процесса.
- PM/Delivery Manager: нужна объяснимая причина, почему работа идет медленно.
- Process owner / QA lead: нужен сигнал, что именно становится bottleneck.

## 4. MVP-сценарии

### Сценарий A. Overview по проекту

Пользователь видит:

- average cycle time;
- median lead time;
- average time in status groups;
- top bottleneck stage;
- rework rate;
- throughput trend.

### Сценарий B. Breakdown по стадиям

Пользователь раскрывает проект или компонент и видит:

- сколько времени задачи проводят в `Development`, `Review`, `QA`, `Waiting`, `Done`;
- где накапливается очередь;
- как отличается поток по компонентам.

### Сценарий C. Trend analysis

Пользователь смотрит динамику по неделям:

- улучшается ли cycle time;
- растет ли review queue;
- падает ли throughput;
- где вырос rework.

## 5. Границы MVP

### В MVP входит

- статус-группы и flow metrics по issue/epic/project/component;
- historical snapshots агрегатов по дням или неделям;
- обзорный экран с bottleneck tables и charts;
- фильтры по проекту, компоненту и времени.

### В MVP не входит

- user-level performance ranking;
- SLA/OKR automation;
- предиктивная симуляция очередей;
- сложные BI-экспорты.

## 6. Что уже есть в проекте

Сильная база для фичи уже заложена:

- `IssueStatusHistory` хранит все observed transitions в [prisma/schema.prisma](/Users/finnetrolle/dev/anathema/prisma/schema.prisma:242)
- workflow rules уже нормализуют `in progress` и `done` в [src/modules/jira/workflow-rules.ts](/Users/finnetrolle/dev/anathema/src/modules/jira/workflow-rules.ts:1)
- startedAt / markerAt / dueAt уже вычисляются в sync pipeline в [src/modules/jira/derive.ts](/Users/finnetrolle/dev/anathema/src/modules/jira/derive.ts:104)
- staged publish pipeline делает данные пригодными для последующих агрегатов в [src/modules/jira/persist.ts](/Users/finnetrolle/dev/anathema/src/modules/jira/persist.ts:689)

## 7. Главная продуктовая гипотеза

Командам сложно улучшать процесс, потому что они видят только “кто чем занят”, но не видят “где время сгорает”. Если показать потери по стадиям и компонентам, то команда начнет устранять системные bottleneck-ы.

## 8. Модель стадий для MVP

Для фичи нужно ввести нормализованные `flow stages`:

- `BACKLOG`
- `DEVELOPMENT`
- `REVIEW`
- `QA`
- `WAITING`
- `DONE`

### Принцип

Сырые Jira-статусы должны быть сопоставлены с flow stage. Текущих `inProgressStatuses/doneStatuses` недостаточно, поэтому нужен отдельный mapping-слой.

## 9. Изменения в data model

### Новые сущности

- [ ] Добавить `WorkflowStageMapping`
  - `id`
  - `jiraConnectionId`
  - `jiraStatusName`
  - `flowStage`
  - `isDefault`

- [ ] Добавить `FlowMetricsSnapshot`
  - `id`
  - `jiraConnectionId`
  - `jiraProjectId?`
  - `componentName?`
  - `epicId?`
  - `snapshotDate`
  - `periodType` (`DAY`, `WEEK`)
  - `throughput`
  - `avgCycleTimeHours`
  - `medianCycleTimeHours`
  - `avgLeadTimeHours`
  - `flowEfficiency`
  - `reworkRate`
  - `bottleneckStage`
  - `metricsJson`

- [ ] Добавить `IssueStageDuration`
  - `id`
  - `issueId`
  - `flowStage`
  - `enteredAt`
  - `leftAt`
  - `durationHours`
  - `syncRunId`

### Почему нужны отдельные таблицы

- bottleneck analytics требует исторических агрегатов;
- metrics надо строить повторяемо и дешево читать;
- stage durations лучше один раз вычислить, чем пересобирать на каждый page view.

## 10. Backend-план

### Этап 1. Нормализация стадий

- [ ] Расширить workflow config, чтобы маппить Jira statuses в flow stages
- [ ] Поддержать fallback mappings для стандартных статусов:
  - `Code Review` -> `REVIEW`
  - `QA` / `In QA` -> `QA`
  - `Blocked` / `Waiting` -> `WAITING`
- [ ] Добавить валидацию конфигурации mapping-а

### Этап 2. Расчет stage durations

- [ ] Создать модуль `src/modules/flow-analytics/`
- [ ] Реализовать функцию, которая строит stage intervals из `IssueStatusHistory`
- [ ] Реализовать обработку edge cases:
  - missing initial status;
  - repeated transitions into same status;
  - reopened issues;
  - незавершенные текущие интервалы
- [ ] Persist-ить `IssueStageDuration`

### Этап 3. Расчет агрегатов

- [ ] Реализовать issue-level metrics:
  - lead time;
  - cycle time;
  - time in stage;
  - number of reentries into stage
- [ ] Реализовать aggregate metrics:
  - throughput;
  - average / median cycle time;
  - review time;
  - QA time;
  - waiting time;
  - flow efficiency;
  - rework rate;
  - bottleneck stage

### Этап 4. Snapshot pipeline

- [ ] Строить daily/weekly snapshots после успешного sync
- [ ] Пересчитывать snapshots при изменении stage mapping rules
- [ ] Подготовить backfill job для исторических данных

## 11. API-план

- [ ] Добавить `GET /api/flow-analytics/overview`
  - top-level metrics for selected scope

- [ ] Добавить `GET /api/flow-analytics/bottlenecks`
  - bottleneck stages by project/component/epic

- [ ] Добавить `GET /api/flow-analytics/trends`
  - daily/weekly time series

- [ ] Добавить `GET /api/flow-analytics/issues`
  - issue list behind a metric or bottleneck

- [ ] Добавить `POST /api/flow-analytics/recompute`
  - manual rebuild after config changes

## 12. UI-план

### Основной экран

- [ ] Добавить страницу `/flow-analytics`
- [ ] Показать summary block:
  - throughput
  - average cycle time
  - flow efficiency
  - rework rate
  - top bottleneck stage

### Визуализации

- [ ] Trend chart по throughput и cycle time
- [ ] Stacked stage duration chart
- [ ] Table по components / epics / projects
- [ ] Heatmap bottleneck by stage and component

### Drill-down

- [ ] Из каждой метрики можно открыть underlying issue set
- [ ] Для bottleneck stage показывать:
  - affected issues;
  - avg duration;
  - change vs previous period;
  - likely causes

## 13. План задач по этапам

### Sprint 1. Stage mapping + durations

- [ ] Подготовить Prisma schema и миграции
- [ ] Реализовать stage mapping model
- [ ] Реализовать issue stage duration builder
- [ ] Покрыть edge cases тестами

### Sprint 2. Aggregates + API

- [ ] Реализовать aggregate metric computation
- [ ] Persist-ить daily/weekly snapshots
- [ ] Поднять API overview, trends, bottlenecks

### Sprint 3. Dashboard

- [ ] Собрать страницу `/flow-analytics`
- [ ] Добавить trends, tables и drill-down
- [ ] Синхронизировать filters с timeline/project scope

## 14. Тестирование

- [ ] Unit-тесты на stage mapping
- [ ] Unit-тесты на duration calculation
- [ ] Unit-тесты на reopened / rework scenarios
- [ ] Integration-тесты snapshot builder
- [ ] Smoke-тесты API overview и trends

## 15. Метрики успеха

- снижение average cycle time;
- снижение average review/QA waiting time;
- рост flow efficiency;
- снижение rework rate;
- снижение доли задач, застрявших в bottleneck stage;
- регулярность использования analytics page менеджерами и TL.

## 16. Риски и смягчение

### Риск: некорректный status-to-stage mapping

- [ ] Сделать mapping конфигурируемым на уровне connection
- [ ] Показывать текущий mapping в admin/debug UI

### Риск: плохая интерпретация метрик как оценки людей

- [ ] Ограничить UX формулировками про процесс, а не про персональную эффективность
- [ ] Не делать people ranking в MVP

### Риск: тяжелые вычисления при каждом запросе

- [ ] Вычислять stage durations и snapshots заранее
- [ ] Читать dashboard из агрегатов, а не из сырых историй

## 17. Definition of Done

- [ ] Для выбранного scope доступны cycle time, throughput, flow efficiency и bottleneck stage
- [ ] Сырые Jira-статусы корректно отображаются в flow stages
- [ ] Есть historical trends по дням/неделям
- [ ] Из bottleneck можно провалиться в underlying issues
- [ ] Все ключевые расчеты покрыты тестами

## 18. Следующий этап после MVP

- сценарное сравнение “до/после” процессных изменений;
- алерты на рост review queue и rework;
- рекомендации по process improvement;
- портфельный обзор bottleneck-ов по нескольким командам.
