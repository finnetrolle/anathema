# Finding 5: Minimal Quality Gates Are Missing

## Проблема

В репозитории есть только базовые команды разработки и Prisma, но нет
обязательных quality gates:

- `lint`
- `typecheck`
- `test`
- простого integration/smoke слоя

Затронутые места:

- `package.json`
- весь pipeline разработки

## Почему это важно

Проект уже содержит несколько зон, где легко получить незаметную регрессию:

- Jira sync и chunked import;
- вычисление `startedAt` по changelog;
- построение диапазона и day-grid;
- извлечение derived-данных из `rawPayload`.

Без автоматических проверок команда будет узнавать о проблемах слишком поздно:

- вручную в браузере;
- после неуспешного sync;
- после изменения схемы;
- после merge нескольких параллельных веток.

## Целевое поведение

У проекта должен появиться минимальный, но обязательный набор проверок:

1. `lint` для качества TypeScript/React-кода.
2. `typecheck` для статической гарантии типов.
3. `test` для pure-логики.
4. `test:integration` или `test:smoke` для основных сценариев sync и загрузки.
5. одна агрегирующая команда, например `npm run check`.

## Рекомендуемое решение

Рекомендуемый путь: **внедрять quality gates по слоям, начиная с самых дешевых**.

### Фаза 1. Базовые команды

Добавить в `package.json`:

- `lint`
- `typecheck`
- `test`
- `check`

Практичный стек:

- ESLint для Next.js + TypeScript
- `tsc --noEmit`
- Vitest для unit-тестов

### Фаза 2. Unit tests на самую ценную логику

Первыми тестировать стоит не UI-кнопки, а доменную логику:

- `src/modules/jira/derive.ts`
- `src/modules/timeline/build-timeline.ts`
- helpers из `load-dashboard.ts`, если они будут выделены в отдельные функции

Минимальные сценарии:

- переход в in-progress определяет `startedAt`;
- done / due / none корректно маппятся в `markerKind`;
- weekend-skipping и span-расчет в таймлайне;
- пустой диапазон и range clipping.

### Фаза 3. Integration tests

Нужен хотя бы один слой интеграции для sync:

- sync chunk пишет ожидаемые записи;
- failed sync не публикует данные;
- dashboard читает только релевантный набор задач.

Если staging/publish из finding 1 будет внедрен, integration тесты становятся
обязательными.

### Фаза 4. CI или локальная обязательная команда

Минимум:

- `npm run check` перед merge

Желательно:

- GitHub Actions или другой CI pipeline, который запускает:
  - install
  - typecheck
  - lint
  - test
  - build

## Какие изменения нужны

### В `package.json`

Добавить команды примерно такого вида:

```json
{
  "scripts": {
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

Конкретные команды можно адаптировать под выбранный инструментарий.

### В зависимостях

Вероятно понадобятся:

- `eslint`
- `eslint-config-next`
- `vitest`
- при интеграционных тестах: `testcontainers`, отдельная test DB или docker-based
  setup

## Пошаговый план внедрения

1. Добавить `typecheck` и `lint`.
2. Подключить Vitest.
3. Написать unit-тесты на `derive.ts` и `build-timeline.ts`.
4. Собрать одну smoke/integration проверку на sync.
5. Добавить агрегирующую команду `check`.
6. Подключить эту команду в CI.

## Критерии готовности

- новый разработчик может одной командой проверить базовое здоровье проекта;
- регрессии в derive/build-timeline ловятся до ручной проверки;
- PR нельзя считать безопасным, если он не проходит `check`;
- build, lint, typecheck и tests имеют воспроизводимый локальный запуск.

## Что даст наибольшую отдачу в первую очередь

Если времени мало, самый выгодный старт такой:

1. `typecheck`
2. `lint`
3. unit-тесты для `derive.ts`
4. unit-тесты для `build-timeline.ts`

Этого уже хватит, чтобы резко снизить риск случайных поломок в ядре продукта.
