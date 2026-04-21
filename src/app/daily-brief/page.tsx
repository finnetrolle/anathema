import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { LanguageToggle } from "@/components/layout/language-toggle";
import { ThemeToggle } from "@/components/timeline/theme-toggle";
import {
  buildDailyBriefHeadline,
  formatDailyBriefScopeLabel,
  getDailyBriefImportanceLabel,
  getDailyBriefPresetLabel,
  getDailyBriefReason,
  getDailyBriefScopeTypeLabel,
  localizeDailyBriefAssignee,
  localizeDailyBriefComponent,
  localizeDailyBriefEpicKey,
} from "@/modules/daily-brief/presenter";
import { loadDailyBriefDashboard } from "@/modules/daily-brief/load-daily-brief";
import type { DailyBriefViewItem } from "@/modules/daily-brief/types";
import type { AppLocale } from "@/modules/i18n/config";
import {
  formatOptionalDate,
  formatOptionalDateTime,
  translateSyncStatus,
} from "@/modules/i18n/presenter";
import { getAppLocale } from "@/modules/i18n/server";

export const dynamic = "force-dynamic";

type DailyBriefPageProps = {
  searchParams?: Promise<{
    scopeType?: string | string[];
    project?: string | string[];
    person?: string | string[];
    preset?: string | string[];
    from?: string | string[];
    to?: string | string[];
    actionableOnly?: string | string[];
    regenerate?: string | string[];
  }>;
};

const COPY: Record<
  AppLocale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    timeline: string;
    riskRadar: string;
    scope: string;
    project: string;
    person: string;
    window: string;
    from: string;
    to: string;
    allOption: string;
    actionableOnly: string;
    apply: string;
    reset: string;
    regenerate: string;
    noEstimate: string;
    emptySection: string;
    noEpic: string;
    status: string;
    started: string;
    due: string;
    resolved: string;
    estimate: string;
    devActivity: string;
    summaryWindow: string;
    summaryGenerated: string;
    completed: string;
    attention: string;
    handoffs: string;
    people: string;
    latestSync: string;
    fetched: string;
    finished: string;
    noSuccessfulSync: string;
    peopleCovered: string;
    noPeopleInBrief: string;
    history: string;
    noHistory: string;
    noBriefEyebrow: string;
    noBriefTitle: string;
    noBriefBody: string;
    historyDone: string;
    historyStarted: string;
    historyAttention: string;
    sections: {
      completed: {
        eyebrow: string;
        title: string;
      };
      started: {
        eyebrow: string;
        title: string;
      };
      needsAttention: {
        eyebrow: string;
        title: string;
      };
      ownershipChanges: {
        eyebrow: string;
        title: string;
      };
      topicsForStandup: {
        eyebrow: string;
        title: string;
      };
    };
  }
> = {
  ru: {
    eyebrow: "Асинхронный стендап",
    title: "Ежедневный бриф",
    subtitle:
      "Утренний снимок того, что стартовало, завершилось, застряло или требует внимания.",
    timeline: "Таймлайн",
    riskRadar: "Радар рисков",
    scope: "Скоуп",
    project: "Проект",
    person: "Человек",
    window: "Окно",
    from: "С",
    to: "По",
    allOption: "Все / н.д.",
    actionableOnly: "Только actionable-пункты",
    apply: "Применить",
    reset: "Сбросить",
    regenerate: "Пересобрать",
    noEstimate: "Без оценки",
    emptySection: "В выбранный бриф в этот раздел ничего не попало.",
    noEpic: "Без эпика",
    status: "Статус",
    started: "Старт",
    due: "Срок",
    resolved: "Завершено",
    estimate: "Оценка",
    devActivity: "Dev-активность",
    summaryWindow: "Окно",
    summaryGenerated: "Сгенерировано",
    completed: "Завершено",
    attention: "Внимание",
    handoffs: "Хенд-оффы",
    people: "Люди",
    latestSync: "Последняя синхронизация",
    fetched: "Загружено",
    finished: "Завершена",
    noSuccessfulSync: "Пока нет успешной синхронизации.",
    peopleCovered: "Люди в брифе",
    noPeopleInBrief: "В этом брифе пока нет людей.",
    history: "История",
    noHistory: "Сохранённой истории брифов пока нет.",
    noBriefEyebrow: "Бриф ещё не создан",
    noBriefTitle: "Запусти синхронизацию Jira или выбери scope, чтобы сгенерировать первый бриф.",
    noBriefBody:
      "Бриф строится по сохранённым Jira issues, changelog history, due date и сигналам code activity после успешной синхронизации.",
    historyDone: "готово",
    historyStarted: "стартовало",
    historyAttention: "внимание",
    sections: {
      completed: {
        eyebrow: "Delivery",
        title: "Завершено с прошлого брифа",
      },
      started: {
        eyebrow: "Flow",
        title: "Стартовало / вошло в прогресс",
      },
      needsAttention: {
        eyebrow: "Attention",
        title: "Требует внимания",
      },
      ownershipChanges: {
        eyebrow: "Ownership",
        title: "Смена исполнителя",
      },
      topicsForStandup: {
        eyebrow: "Standup",
        title: "Темы для стендапа",
      },
    },
  },
  en: {
    eyebrow: "Async Standup",
    title: "Daily Brief",
    subtitle: "Morning snapshot of what started, finished, got stuck, or needs attention.",
    timeline: "Timeline",
    riskRadar: "Risk radar",
    scope: "Scope",
    project: "Project",
    person: "Person",
    window: "Window",
    from: "From",
    to: "To",
    allOption: "All / n/a",
    actionableOnly: "Only actionable items",
    apply: "Apply",
    reset: "Reset",
    regenerate: "Regenerate",
    noEstimate: "No estimate",
    emptySection: "Nothing landed in this section for the selected brief.",
    noEpic: "No epic",
    status: "Status",
    started: "Started",
    due: "Due",
    resolved: "Resolved",
    estimate: "Estimate",
    devActivity: "Dev activity",
    summaryWindow: "Window",
    summaryGenerated: "Generated",
    completed: "Completed",
    attention: "Attention",
    handoffs: "Handoffs",
    people: "People",
    latestSync: "Latest sync",
    fetched: "Fetched",
    finished: "Finished",
    noSuccessfulSync: "No successful sync yet.",
    peopleCovered: "People covered",
    noPeopleInBrief: "No people in this brief.",
    history: "History",
    noHistory: "No saved brief history yet.",
    noBriefEyebrow: "No Daily Brief Yet",
    noBriefTitle: "Run a Jira sync or choose a scope to generate the first brief.",
    noBriefBody:
      "The brief is built from persisted Jira issues, changelog history, due dates, and code activity signals after a successful sync.",
    historyDone: "done",
    historyStarted: "started",
    historyAttention: "attention",
    sections: {
      completed: {
        eyebrow: "Delivery",
        title: "Completed Since Last Brief",
      },
      started: {
        eyebrow: "Flow",
        title: "Started / Moved Into Progress",
      },
      needsAttention: {
        eyebrow: "Attention",
        title: "Needs Attention",
      },
      ownershipChanges: {
        eyebrow: "Ownership",
        title: "Ownership Changes",
      },
      topicsForStandup: {
        eyebrow: "Standup",
        title: "Topics For Standup",
      },
    },
  },
};

function firstQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatEstimate(item: DailyBriefViewItem, locale: AppLocale) {
  const values = [
    item.details.estimateHours === null ? null : `${item.details.estimateHours}h`,
    item.details.estimateStoryPoints === null
      ? null
      : `${item.details.estimateStoryPoints} SP`,
  ].filter((value): value is string => Boolean(value));

  return values.length > 0 ? values.join(" · ") : COPY[locale].noEstimate;
}

function formatHistoryScopeLabel(
  scopeType: string,
  scopeLabel: string,
  locale: AppLocale,
) {
  if (scopeType !== "TEAM") {
    return scopeLabel;
  }

  const [, ...rest] = scopeLabel.split("·");
  const connectionName = rest.join("·").trim();

  return `${locale === "ru" ? "Команда" : "Team"}${connectionName ? ` · ${connectionName}` : ""}`;
}

function Section({
  title,
  eyebrow,
  items,
  locale,
}: {
  title: string;
  eyebrow: string;
  items: DailyBriefViewItem[];
  locale: AppLocale;
}) {
  const copy = COPY[locale];

  return (
    <section className="daily-brief-section">
      <div className="daily-brief-section__header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="daily-brief-section__title">{title}</h2>
        </div>
        <span className="daily-brief-section__count">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="daily-brief-empty">{copy.emptySection}</div>
      ) : (
        <div className="daily-brief-list">
          {items.map((item) => (
            <article className="daily-brief-item" key={item.id}>
              <div className="daily-brief-item__main">
                <div className="daily-brief-item__title-row">
                  <span
                    className={`daily-brief-chip daily-brief-chip--${item.importance.toLowerCase()}`}
                  >
                    {getDailyBriefImportanceLabel(item.importance, locale)}
                  </span>
                  {item.issueUrl ? (
                    <a href={item.issueUrl} rel="noreferrer" target="_blank">
                      {item.issueKey}
                    </a>
                  ) : (
                    <span>{item.issueKey}</span>
                  )}
                  <strong>{item.issueSummary}</strong>
                </div>

                <p className="daily-brief-item__reason">{getDailyBriefReason(item, locale)}</p>

                <div className="daily-brief-item__meta">
                  <span>{localizeDailyBriefAssignee(item.assigneeName, locale)}</span>
                  <span>
                    {item.projectKey} · {item.projectName}
                  </span>
                  <span>{localizeDailyBriefComponent(item.componentName, locale)}</span>
                  <span>{localizeDailyBriefEpicKey(item.epicKey, locale)}</span>
                </div>
              </div>

              <dl className="daily-brief-item__facts">
                <div>
                  <dt>{copy.status}</dt>
                  <dd>{item.details.status}</dd>
                </div>
                <div>
                  <dt>{copy.started}</dt>
                  <dd>{formatOptionalDate(item.details.startAt, locale)}</dd>
                </div>
                <div>
                  <dt>{copy.due}</dt>
                  <dd>{formatOptionalDate(item.details.dueAt, locale)}</dd>
                </div>
                <div>
                  <dt>{copy.resolved}</dt>
                  <dd>{formatOptionalDate(item.details.resolvedAt, locale)}</dd>
                </div>
                <div>
                  <dt>{copy.estimate}</dt>
                  <dd>{formatEstimate(item, locale)}</dd>
                </div>
                <div>
                  <dt>{copy.devActivity}</dt>
                  <dd>
                    {item.details.pullRequestCount} PR · {item.details.commitCount}{" "}
                    {locale === "ru" ? "коммитов" : "commits"}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function buildRegenerateHref(params: {
  scopeType: string;
  project: string;
  person: string;
  preset: string;
  from: string;
  to: string;
  actionableOnly: boolean;
}) {
  const searchParams = new URLSearchParams();

  searchParams.set("scopeType", params.scopeType);
  if (params.project) {
    searchParams.set("project", params.project);
  }
  if (params.person) {
    searchParams.set("person", params.person);
  }
  searchParams.set("preset", params.preset);
  if (params.from) {
    searchParams.set("from", params.from);
  }
  if (params.to) {
    searchParams.set("to", params.to);
  }
  if (params.actionableOnly) {
    searchParams.set("actionableOnly", "1");
  }
  searchParams.set("regenerate", "1");

  return `/daily-brief?${searchParams.toString()}`;
}

export default async function DailyBriefPage({ searchParams }: DailyBriefPageProps) {
  noStore();

  const locale = await getAppLocale();
  const copy = COPY[locale];
  const resolvedSearchParams = (await searchParams) ?? {};
  const dashboard = await loadDailyBriefDashboard({
    scopeType: firstQueryValue(resolvedSearchParams.scopeType),
    project: firstQueryValue(resolvedSearchParams.project),
    person: firstQueryValue(resolvedSearchParams.person),
    preset: firstQueryValue(resolvedSearchParams.preset),
    from: firstQueryValue(resolvedSearchParams.from),
    to: firstQueryValue(resolvedSearchParams.to),
    regenerate: firstQueryValue(resolvedSearchParams.regenerate) === "1",
    actionableOnly: firstQueryValue(resolvedSearchParams.actionableOnly) === "1",
  });

  const briefScopeLabel = dashboard.brief
    ? formatDailyBriefScopeLabel(dashboard.brief.scope, locale)
    : null;
  const briefHeadline =
    dashboard.brief && briefScopeLabel
      ? buildDailyBriefHeadline(briefScopeLabel, dashboard.brief.summary.counts, locale)
      : null;

  return (
    <main className="page-shell">
      <section className="section-card daily-brief-page">
        <div className="section-header">
          <div className="section-header__main daily-brief-page__title-block">
            <div>
              <span className="eyebrow">{copy.eyebrow}</span>
              <h1 className="section-header__title">{copy.title}</h1>
              <p className="daily-brief-page__subtitle">{copy.subtitle}</p>
            </div>
          </div>

          <div className="section-header__side">
            <LanguageToggle locale={locale} />
            <Link className="timeline-button timeline-button--ghost" href="/">
              {copy.timeline}
            </Link>
            <Link className="timeline-button timeline-button--ghost" href="/risk-radar">
              {copy.riskRadar}
            </Link>
            <ThemeToggle locale={locale} />
          </div>
        </div>

        <form className="daily-brief-filters" method="GET">
          <label className="timeline-field">
            <span>{copy.scope}</span>
            <select defaultValue={dashboard.filters.scopeType} name="scopeType">
              <option value="TEAM">{getDailyBriefScopeTypeLabel("TEAM", locale)}</option>
              <option value="PROJECT">{getDailyBriefScopeTypeLabel("PROJECT", locale)}</option>
              <option value="PERSON">{getDailyBriefScopeTypeLabel("PERSON", locale)}</option>
            </select>
          </label>

          <label className="timeline-field">
            <span>{copy.project}</span>
            <select defaultValue={dashboard.filters.project} name="project">
              <option value="">{copy.allOption}</option>
              {dashboard.scopeOptions.projects.map((project) => (
                <option key={project.key} value={project.key}>
                  {project.label}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-field">
            <span>{copy.person}</span>
            <select defaultValue={dashboard.filters.person} name="person">
              <option value="">{copy.allOption}</option>
              {dashboard.scopeOptions.people.map((person) => (
                <option key={person.key} value={person.key}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-field">
            <span>{copy.window}</span>
            <select defaultValue={dashboard.filters.preset} name="preset">
              <option value="PREVIOUS_BUSINESS_DAY">
                {getDailyBriefPresetLabel("PREVIOUS_BUSINESS_DAY", locale)}
              </option>
              <option value="LAST_24H">{getDailyBriefPresetLabel("LAST_24H", locale)}</option>
              <option value="CUSTOM">{getDailyBriefPresetLabel("CUSTOM", locale)}</option>
            </select>
          </label>

          <label className="timeline-field">
            <span>{copy.from}</span>
            <input defaultValue={dashboard.filters.from} name="from" type="date" />
          </label>

          <label className="timeline-field">
            <span>{copy.to}</span>
            <input defaultValue={dashboard.filters.to} name="to" type="date" />
          </label>

          <label className="daily-brief-checkbox">
            <input
              defaultChecked={dashboard.filters.actionableOnly}
              name="actionableOnly"
              type="checkbox"
              value="1"
            />
            <span>{copy.actionableOnly}</span>
          </label>

          <div className="timeline-actions">
            <button className="timeline-button" type="submit">
              {copy.apply}
            </button>
            <Link className="timeline-button timeline-button--ghost" href="/daily-brief">
              {copy.reset}
            </Link>
            <Link
              className="timeline-button timeline-button--ghost"
              href={buildRegenerateHref({
                scopeType: dashboard.filters.scopeType,
                project: dashboard.filters.project,
                person: dashboard.filters.person,
                preset: dashboard.filters.preset,
                from: dashboard.filters.from,
                to: dashboard.filters.to,
                actionableOnly: dashboard.filters.actionableOnly,
              })}
            >
              {copy.regenerate}
            </Link>
          </div>
        </form>

        {dashboard.brief && briefScopeLabel && briefHeadline ? (
          <div className="daily-brief-layout">
            <div className="daily-brief-main">
              <section className="daily-brief-summary">
                <div className="daily-brief-summary__content">
                  <div>
                    <span className="eyebrow">{briefScopeLabel}</span>
                    <h2 className="daily-brief-summary__title">{briefHeadline}</h2>
                    <p className="daily-brief-summary__meta">
                      {copy.summaryWindow}:{" "}
                      {formatOptionalDateTime(dashboard.brief.summary.windowStart, locale)} -{" "}
                      {formatOptionalDateTime(dashboard.brief.summary.windowEnd, locale)}
                    </p>
                    <p className="daily-brief-summary__meta">
                      {copy.summaryGenerated}: {formatOptionalDateTime(dashboard.brief.updatedAt, locale)}
                    </p>
                  </div>

                  <div className="daily-brief-stats">
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.completedCount}</strong>
                      <span>{copy.completed}</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.startedCount}</strong>
                      <span>{copy.started}</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.attentionCount}</strong>
                      <span>{copy.attention}</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.ownershipChangesCount}</strong>
                      <span>{copy.handoffs}</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.peopleCovered}</strong>
                      <span>{copy.people}</span>
                    </div>
                  </div>
                </div>
              </section>

              <Section
                eyebrow={copy.sections.completed.eyebrow}
                items={dashboard.brief.sections.completed}
                locale={locale}
                title={copy.sections.completed.title}
              />
              <Section
                eyebrow={copy.sections.started.eyebrow}
                items={dashboard.brief.sections.started}
                locale={locale}
                title={copy.sections.started.title}
              />
              <Section
                eyebrow={copy.sections.needsAttention.eyebrow}
                items={dashboard.brief.sections.needsAttention}
                locale={locale}
                title={copy.sections.needsAttention.title}
              />
              <Section
                eyebrow={copy.sections.ownershipChanges.eyebrow}
                items={dashboard.brief.sections.ownershipChanges}
                locale={locale}
                title={copy.sections.ownershipChanges.title}
              />
              <Section
                eyebrow={copy.sections.topicsForStandup.eyebrow}
                items={dashboard.brief.sections.topicsForStandup}
                locale={locale}
                title={copy.sections.topicsForStandup.title}
              />
            </div>

            <aside className="daily-brief-sidebar">
              <section className="daily-brief-panel">
                <span className="eyebrow">{copy.latestSync}</span>
                {dashboard.latestSync ? (
                  <dl className="daily-brief-sidebar__facts">
                    <div>
                      <dt>{copy.status}</dt>
                      <dd>{translateSyncStatus(dashboard.latestSync.status, locale)}</dd>
                    </div>
                    <div>
                      <dt>{copy.fetched}</dt>
                      <dd>{dashboard.latestSync.issuesFetched}</dd>
                    </div>
                    <div>
                      <dt>{copy.finished}</dt>
                      <dd>{formatOptionalDateTime(dashboard.latestSync.finishedAt, locale)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="daily-brief-empty">{copy.noSuccessfulSync}</p>
                )}
              </section>

              <section className="daily-brief-panel">
                <span className="eyebrow">{copy.peopleCovered}</span>
                {dashboard.brief.summary.people.length > 0 ? (
                  <div className="daily-brief-tag-list">
                    {dashboard.brief.summary.people.map((person) => (
                      <span className="daily-brief-tag" key={person}>
                        {localizeDailyBriefAssignee(person, locale)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="daily-brief-empty">{copy.noPeopleInBrief}</p>
                )}
              </section>

              <section className="daily-brief-panel">
                <span className="eyebrow">{copy.history}</span>
                {dashboard.history.length > 0 ? (
                  <div className="daily-brief-history">
                    {dashboard.history.map((entry) => (
                      <article className="daily-brief-history__item" key={entry.id}>
                        <strong>{formatOptionalDateTime(entry.generatedForDate, locale)}</strong>
                        <p>
                          {buildDailyBriefHeadline(
                            formatHistoryScopeLabel(
                              entry.scopeType,
                              entry.scopeLabel,
                              locale,
                            ),
                            entry.counts,
                            locale,
                          )}
                        </p>
                        <span>
                          {entry.counts.completedCount} {copy.historyDone} ·{" "}
                          {entry.counts.startedCount} {copy.historyStarted} ·{" "}
                          {entry.counts.attentionCount} {copy.historyAttention}
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="daily-brief-empty">{copy.noHistory}</p>
                )}
              </section>
            </aside>
          </div>
        ) : (
          <div className="empty-state">
            <span className="eyebrow">{copy.noBriefEyebrow}</span>
            <h3>{copy.noBriefTitle}</h3>
            <p>{copy.noBriefBody}</p>
          </div>
        )}
      </section>
    </main>
  );
}
