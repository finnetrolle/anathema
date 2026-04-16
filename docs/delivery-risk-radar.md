# Delivery Risk Radar

## 1. Цель фичи

`Delivery Risk Radar` должен не просто показывать текущий статус задач, а заранее подсвечивать, где delivery с высокой вероятностью сорвется или деградирует.

Фича должна отвечать на вопрос:

1. Где есть риск сейчас.
2. Почему система считает это риском.
3. Какой уровень риска у эпика, проекта, компонента или человека.
4. Куда менеджеру стоит вмешаться сегодня.

## 2. Business-value

- Снизить вероятность срыва дедлайнов и roadmap commitments.
- Раньше выявлять проблемы, чем они всплывут на релизе или перед клиентом.
- Дать менеджменту ранний сигнал, а не post-factum отчет.
- Повысить predictability delivery без ручного микроменеджмента.

## 3. Основные пользователи

- Engineering Manager: нужен список зон, куда надо вмешаться сегодня.
- Team Lead: нужен risk list по команде и по эпикам.
- PM/Delivery Manager: нужен прогноз по проектам и объяснимый риск.
- Руководитель направления: нужен агрегированный heatmap по портфелю.

## 4. MVP-сценарии

### Сценарий A. Risk overview по проекту

Пользователь открывает страницу Risk Radar и видит:

- общий risk score по проекту;
- топ рискованных эпиков;
- список задач с high risk;
- breakdown по причинам риска.

### Сценарий B. Epic drill-down

Пользователь кликает на эпик и видит:

- какие задачи тянут epic risk вверх;
- какие сигналы сработали;
- насколько риск новый или устойчивый.

### Сценарий C. People/Component hotspots

Пользователь фильтрует по component или assignee и видит:

- перегруженные зоны;
- aging work;
- churn и handoff;
- риски без реального движения.

## 5. Границы MVP

### В MVP входит

- risk scoring на уровне issue, epic, project;
- explainability через risk reasons;
- обзорная страница и drill-down;
- пересчет риска после каждого успешного sync;
- фильтры по проекту, компоненту, человеку.

### В MVP не входит

- ML-модель или predictive AI;
- финансовый прогноз ущерба;
- автоматическая эскалация во внешние каналы;
- кастомные правила риска для каждой роли.

## 6. Источники сигнала

Проект уже хранит данные, из которых можно строить риск:

- timeline markers, due dates, status transitions в [prisma/schema.prisma](/Users/finnetrolle/dev/anathema/prisma/schema.prisma:208)
- история статусов и sync trail в [prisma/schema.prisma](/Users/finnetrolle/dev/anathema/prisma/schema.prisma:242)
- story points, assignee history, PR/commit signals в [src/modules/timeline/load-dashboard.ts](/Users/finnetrolle/dev/anathema/src/modules/timeline/load-dashboard.ts:920)
- предупреждения по task hygiene в [src/components/timeline/timeline-board.tsx](/Users/finnetrolle/dev/anathema/src/components/timeline/timeline-board.tsx:596)

### Базовые risk signals для MVP

- overdue task;
- in progress without due date;
- in progress without estimate;
- aging WIP above threshold;
- no commits / no PR while task is in progress;
- frequent assignee changes;
- reopen after done;
- epic with too many risky children;
- concentration risk: слишком много risky issues на одном assignee или компоненте.

## 7. Risk model MVP

### Уровни риска

- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

### Принцип расчета

Каждой задаче назначается:

- итоговый `riskScore` от `0` до `100`;
- список `riskReasons`;
- `riskLevel`.

### Пример весов для первой версии

- overdue: `+30`
- aging WIP: `+20`
- no estimate: `+10`
- no due date: `+10`
- no dev activity: `+15`
- assignee churn: `+15`
- reopened: `+25`

Epic и project risk считаются как агрегат:

- weighted average child issue risk;
- bonus за количество `HIGH/CRITICAL` issues;
- bonus за spread по нескольким компонентам.

## 8. Изменения в data model

### Новые сущности

- [ ] Добавить `RiskSnapshot`
  - `id`
  - `jiraConnectionId`
  - `jiraProjectId?`
  - `epicId?`
  - `issueId?`
  - `entityType` (`PROJECT`, `EPIC`, `ISSUE`, `ASSIGNEE`, `COMPONENT`)
  - `entityKey`
  - `riskScore`
  - `riskLevel`
  - `computedAt`
  - `snapshotDate`

- [ ] Добавить `RiskReason`
  - `id`
  - `riskSnapshotId`
  - `reasonCode`
  - `weight`
  - `detailsJson`

- [ ] Добавить `RiskThresholdConfig`
  - `jiraConnectionId`
  - `agingDaysWarning`
  - `agingDaysCritical`
  - `reassignmentsThreshold`
  - `staleDevActivityDays`
  - `epicHighRiskIssueCount`

### Зачем это нужно

- риск должен быть объяснимым и историчным;
- нужны исторические snapshots для трендов;
- thresholds должны стать конфигурируемыми, а не зашитыми в код.

## 9. Backend-план

### Этап 1. Доменный слой риска

- [ ] Создать модуль `src/modules/risk-radar/`
- [ ] Описать типы:
  - `RiskEntity`
  - `RiskReasonCode`
  - `RiskScore`
  - `RiskSummary`
- [ ] Реализовать derive-функции для signals:
  - overdue;
  - aging;
  - missing estimate;
  - missing due date;
  - no dev activity;
  - assignee churn;
  - reopened

### Этап 2. Агрегация

- [ ] Собрать issue-level scoring
- [ ] Реализовать epic aggregation
- [ ] Реализовать project aggregation
- [ ] Добавить aggregation по component и assignee для hotspot view

### Этап 3. Snapshot pipeline

- [ ] Пересчитывать snapshots после успешного sync
- [ ] Сохранять risk snapshots в БД
- [ ] Реализовать пересчет за выбранный project/scope on-demand
- [ ] Подготовить retention policy для старых snapshots

## 10. API-план

- [ ] Добавить `GET /api/risk-radar/overview`
  - project summary
  - top risky epics
  - top risky issues
  - distribution by risk level

- [ ] Добавить `GET /api/risk-radar/entities`
  - список entities по фильтрам
  - сортировка по score и freshness

- [ ] Добавить `GET /api/risk-radar/entity/:id`
  - reasons
  - historical trend
  - linked issues / epics

- [ ] Добавить `POST /api/risk-radar/recompute`
  - manual recompute after config changes

## 11. UI-план

### Основной экран

- [ ] Добавить страницу `/risk-radar`
- [ ] Показать global summary cards:
  - risky issues
  - risky epics
  - critical hotspots
  - new risks since previous snapshot

### Heatmap / Tables

- [ ] Таблица risky epics
- [ ] Таблица risky issues
- [ ] Heatmap по component и assignee
- [ ] Breakdown по reason codes

### Drill-down

- [ ] Карточка риска должна показывать:
  - score;
  - level;
  - reasons;
  - affected scope;
  - linked tasks;
  - CTA “open in timeline”

### UX-требования

- [ ] Explainability обязательна: score без reasons показывать нельзя
- [ ] Должна быть разница между `new risk` и `persistent risk`
- [ ] Фильтры должны синхронизироваться с timeline scopes

## 12. План задач по этапам

### Sprint 1. Signals

- [ ] Подготовить Prisma schema и миграции
- [ ] Реализовать risk signal derivation на уровне issue
- [ ] Покрыть unit-тестами scoring и thresholds

### Sprint 2. Aggregation + API

- [ ] Реализовать epic/project/component/assignee aggregation
- [ ] Реализовать snapshot persistence
- [ ] Поднять API overview и entity details

### Sprint 3. Dashboard

- [ ] Сделать страницу `/risk-radar`
- [ ] Добавить high-level summary
- [ ] Добавить drill-down и filters
- [ ] Добавить сравнение текущего snapshot с предыдущим

## 13. Тестирование

- [ ] Unit-тесты на все risk reason codes
- [ ] Unit-тесты на score normalization
- [ ] Integration-тесты snapshot pipeline
- [ ] Smoke-тест API overview
- [ ] UI smoke-тест risk page

## 14. Метрики успеха

- число high-risk задач, обнаруженных до просрочки;
- снижение доли overdue issues;
- mean time to manager intervention после появления risk flag;
- число “новых critical risks” week-over-week;
- использование risk dashboard менеджерами;
- доля risky epics, по которым были приняты действия.

## 15. Риски и смягчение

### Риск: слишком много false positive

- [ ] Держать explainability и thresholds настраиваемыми
- [ ] Начать с rule-based scoring, а не black-box модели

### Риск: риск без действия не дает ценности

- [ ] Для каждой risk reason добавить recommended next action
- [ ] На UI показать action-oriented wording

### Риск: score станет “магическим числом”

- [ ] В drill-down раскрывать вклад каждого reason в итоговый score

## 16. Definition of Done

- [ ] После sync система пересчитывает issue/epic/project risk
- [ ] Для каждой risky entity есть score, level и reasons
- [ ] Менеджер может открыть риск, понять причину и перейти к задачам
- [ ] Есть история snapshots и сравнение с предыдущим состоянием
- [ ] Пороговые значения вынесены в конфиг

## 17. Следующий этап после MVP

- рекомендации по действиям и owner assignment;
- внешняя эскалация high-risk событий;
- прогноз “вероятность срыва эпика к дате”;
- AI-generated narrative для weekly delivery review.
