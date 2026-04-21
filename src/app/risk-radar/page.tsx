import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { LanguageToggle } from "@/components/layout/language-toggle";
import { ThemeToggle } from "@/components/timeline/theme-toggle";
import type { AppLocale } from "@/modules/i18n/config";
import {
  formatOptionalDateTime,
  getNotAvailableLabel,
} from "@/modules/i18n/presenter";
import { getAppLocale } from "@/modules/i18n/server";
import { loadRiskRadarDashboard } from "@/modules/risk-radar/load-risk-radar";
import { getRiskLevelLabel, getRiskStateLabel } from "@/modules/risk-radar/presenter";
import type {
  RiskEntityDetail,
  RiskEntityView,
  RiskLevel,
  RiskReasonBreakdownItem,
} from "@/modules/risk-radar/types";

export const dynamic = "force-dynamic";

type RiskRadarPageProps = {
  searchParams?: Promise<{
    project?: string | string[];
    component?: string | string[];
    assignee?: string | string[];
    entityId?: string | string[];
  }>;
};

type ActiveFilters = {
  project: string;
  component: string;
  assignee: string;
};

const COPY: Record<
  AppLocale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    timeline: string;
    dailyBrief: string;
    project: string;
    component: string;
    assignee: string;
    allProjects: string;
    allComponents: string;
    allAssignees: string;
    applyFilters: string;
    reset: string;
    latestSnapshot: string;
    previousSnapshot: string;
    latestSync: string;
    noRadarEyebrow: string;
    noRadarTitle: string;
    endpoints: string;
    summaryCards: {
      issuesEyebrow: string;
      issuesLabel: string;
      epicsEyebrow: string;
      epicsLabel: string;
      hotspotsEyebrow: string;
      hotspotsLabel: string;
      newEyebrow: string;
      newLabel: string;
    };
    reasonBreakdownEyebrow: string;
    reasonBreakdownTitle: string;
    noReasons: string;
    reasonHits: string;
    reasonWeight: string;
    distributionEyebrow: string;
    distributionTitle: string;
    nothingRisky: string;
    score: string;
    delta: string;
    linkedIssues: string;
    openInTimeline: string;
    drillDownEyebrow: string;
    whyRisky: string;
    riskDrivers: string;
    noExplainability: string;
    trend: string;
    linkedIssuesTitle: string;
    noLinkedIssues: string;
    projectSummary: string;
    tableEyebrows: {
      epics: string;
      issues: string;
      hotspots: string;
    };
    tableTitles: {
      epics: string;
      issues: string;
      hotspots: string;
    };
  }
> = {
  ru: {
    eyebrow: "Здоровье delivery",
    title: "Радар рисков",
    subtitle:
      "Где delivery может сорваться, почему система считает это риском и куда менеджеру стоит вмешаться сегодня.",
    timeline: "Таймлайн",
    dailyBrief: "Ежедневный бриф",
    project: "Проект",
    component: "Компонент",
    assignee: "Исполнитель",
    allProjects: "Все проекты",
    allComponents: "Все компоненты",
    allAssignees: "Все исполнители",
    applyFilters: "Применить фильтры",
    reset: "Сбросить",
    latestSnapshot: "Последний снапшот",
    previousSnapshot: "Предыдущий снапшот",
    latestSync: "Последняя синхронизация",
    noRadarEyebrow: "Радар пока пуст",
    noRadarTitle: "В текущем scope радару пока нечего показать.",
    endpoints: "Endpoints:",
    summaryCards: {
      issuesEyebrow: "Задачи",
      issuesLabel: "HIGH/CRITICAL задачи в текущем срезе",
      epicsEyebrow: "Эпики",
      epicsLabel: "Рискованные эпики, требующие drill-down",
      hotspotsEyebrow: "Хотспоты",
      hotspotsLabel: "Критические hotspots по людям и компонентам",
      newEyebrow: "Новые",
      newLabel: "Новые риски относительно предыдущего снапшота",
    },
    reasonBreakdownEyebrow: "Explainability",
    reasonBreakdownTitle: "Разбивка причин",
    noReasons: "Для текущего scope ни один reason code не сработал.",
    reasonHits: "срабатываний",
    reasonWeight: "вес",
    distributionEyebrow: "Микс",
    distributionTitle: "Распределение задач",
    nothingRisky: "В этом срезе ничего рискованного не проявилось.",
    score: "Скор",
    delta: "Дельта",
    linkedIssues: "связанных задач",
    openInTimeline: "Открыть в таймлайне",
    drillDownEyebrow: "Детализация",
    whyRisky: "Почему это риск",
    riskDrivers: "Факторы риска",
    noExplainability: "Для этой сущности не сохранён explainability payload.",
    trend: "Тренд",
    linkedIssuesTitle: "Связанные задачи",
    noLinkedIssues: "В текущем контексте снапшота связанные задачи не найдены.",
    projectSummary: "Сводка по проекту",
    tableEyebrows: {
      epics: "Drill-down по эпикам",
      issues: "Немедленное вмешательство",
      hotspots: "Хотспоты",
    },
    tableTitles: {
      epics: "Топ рискованных эпиков",
      issues: "Все рискованные задачи в текущем срезе",
      hotspots: "Хотспоты по людям и компонентам",
    },
  },
  en: {
    eyebrow: "Delivery Health",
    title: "Risk Radar",
    subtitle:
      "Where delivery may slip, why the system considers it risky, and where a manager should intervene today.",
    timeline: "Timeline",
    dailyBrief: "Daily brief",
    project: "Project",
    component: "Component",
    assignee: "Assignee",
    allProjects: "All projects",
    allComponents: "All components",
    allAssignees: "All assignees",
    applyFilters: "Apply filters",
    reset: "Reset",
    latestSnapshot: "Latest snapshot",
    previousSnapshot: "Previous snapshot",
    latestSync: "Latest sync",
    noRadarEyebrow: "No Radar Yet",
    noRadarTitle: "Risk Radar has nothing to show for the current scope.",
    endpoints: "Endpoints:",
    summaryCards: {
      issuesEyebrow: "Issues",
      issuesLabel: "HIGH/CRITICAL issues in the current slice",
      epicsEyebrow: "Epics",
      epicsLabel: "Risky epics demanding drill-down",
      hotspotsEyebrow: "Hotspots",
      hotspotsLabel: "Critical people/component hotspots",
      newEyebrow: "New",
      newLabel: "New risks since the previous snapshot",
    },
    reasonBreakdownEyebrow: "Explainability",
    reasonBreakdownTitle: "Reason Breakdown",
    noReasons: "No reason codes were triggered for the current scope.",
    reasonHits: "hits",
    reasonWeight: "weight",
    distributionEyebrow: "Mix",
    distributionTitle: "Issue Distribution",
    nothingRisky: "Nothing risky surfaced in this slice.",
    score: "Score",
    delta: "Delta",
    linkedIssues: "linked issues",
    openInTimeline: "Open in timeline",
    drillDownEyebrow: "Drill-down",
    whyRisky: "Why this is risky",
    riskDrivers: "Risk factors",
    noExplainability: "No explainability payload was stored for this entity.",
    trend: "Trend",
    linkedIssuesTitle: "Linked issues",
    noLinkedIssues: "No linked issues were found in the current snapshot context.",
    projectSummary: "Project Summary",
    tableEyebrows: {
      epics: "Epic drill-down",
      issues: "Immediate intervention",
      hotspots: "Hotspots",
    },
    tableTitles: {
      epics: "Top Risky Epics",
      issues: "All risky issues in the current slice",
      hotspots: "People & Component Hotspots",
    },
  },
};

function firstQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatScoreDelta(value: number | null) {
  if (value === null || value === 0) {
    return "0";
  }

  return value > 0 ? `+${value}` : String(value);
}

function buildEntityHref(entityId: string, filters: ActiveFilters) {
  const searchParams = new URLSearchParams();

  if (filters.project) {
    searchParams.set("project", filters.project);
  }
  if (filters.component) {
    searchParams.set("component", filters.component);
  }
  if (filters.assignee) {
    searchParams.set("assignee", filters.assignee);
  }
  searchParams.set("entityId", entityId);

  return `/risk-radar?${searchParams.toString()}`;
}

function buildResetHref() {
  return "/risk-radar";
}

function buildLevelClass(level: RiskLevel) {
  return `risk-level risk-level--${level.toLowerCase()}`;
}

function SummaryCard({
  eyebrow,
  value,
  label,
  accent,
}: {
  eyebrow: string;
  value: string | number;
  label: string;
  accent?: "danger" | "warning" | "neutral";
}) {
  return (
    <article className={`risk-summary-card ${accent ? `risk-summary-card--${accent}` : ""}`}>
      <span className="eyebrow">{eyebrow}</span>
      <strong>{value}</strong>
      <p>{label}</p>
    </article>
  );
}

function ReasonBreakdown({
  items,
  locale,
}: {
  items: RiskReasonBreakdownItem[];
  locale: AppLocale;
}) {
  const copy = COPY[locale];

  return (
    <section className="risk-panel">
      <div className="risk-panel__header">
        <div>
          <span className="eyebrow">{copy.reasonBreakdownEyebrow}</span>
          <h2 className="risk-panel__title">{copy.reasonBreakdownTitle}</h2>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="daily-brief-empty">{copy.noReasons}</div>
      ) : (
        <div className="risk-breakdown-list">
          {items.map((item) => (
            <article className="risk-breakdown-item" key={item.reasonCode}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.reasonCode}</p>
              </div>
              <div className="risk-breakdown-item__metrics">
                <span>
                  {item.count} {copy.reasonHits}
                </span>
                <span>
                  {item.totalWeight} {copy.reasonWeight}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Distribution({
  items,
  locale,
}: {
  items: Array<{ level: RiskLevel; count: number }>;
  locale: AppLocale;
}) {
  const copy = COPY[locale];

  return (
    <section className="risk-panel">
      <div className="risk-panel__header">
        <div>
          <span className="eyebrow">{copy.distributionEyebrow}</span>
          <h2 className="risk-panel__title">{copy.distributionTitle}</h2>
        </div>
      </div>

      <div className="risk-distribution">
        {items.map((item) => (
          <article className="risk-distribution__item" key={item.level}>
            <span className={buildLevelClass(item.level)}>
              {getRiskLevelLabel(item.level, locale)}
            </span>
            <strong>{item.count}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function RiskReasonCards({
  entityId,
  reasons,
  locale,
  title,
  embedded = false,
}: {
  entityId: string;
  reasons: RiskEntityView["reasons"];
  locale: AppLocale;
  title?: string;
  embedded?: boolean;
}) {
  const copy = COPY[locale];

  return (
    <div className={`risk-reason-block ${embedded ? "risk-reason-block--embedded" : ""}`}>
      {title ? <p className="risk-reason-block__title">{title}</p> : null}

      {reasons.length === 0 ? (
        <div className="daily-brief-empty">{copy.noExplainability}</div>
      ) : (
        <div className="risk-reason-list">
          {reasons.map((reason) => (
            <article className="risk-reason-card" key={`${entityId}:${reason.reasonCode}`}>
              <div className="risk-reason-card__header">
                <strong>{reason.title}</strong>
                <span>+{reason.weight}</span>
              </div>
              <p>{reason.narrative}</p>
              <div className="risk-reason-card__action">{reason.recommendedAction}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function EntityTable({
  title,
  eyebrow,
  items,
  filters,
  locale,
  showReasonDetails = false,
}: {
  title: string;
  eyebrow: string;
  items: RiskEntityView[];
  filters: ActiveFilters;
  locale: AppLocale;
  showReasonDetails?: boolean;
}) {
  const copy = COPY[locale];

  return (
    <section className="risk-panel">
      <div className="risk-panel__header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="risk-panel__title">{title}</h2>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="daily-brief-empty">{copy.nothingRisky}</div>
      ) : (
        <div className="risk-table">
          {items.map((item) => (
            <article className="risk-row" key={item.id}>
              <div className="risk-row__main">
                <div className="risk-row__title">
                  <span className={buildLevelClass(item.riskLevel)}>
                    {getRiskLevelLabel(item.riskLevel, locale)}
                  </span>
                  <Link href={buildEntityHref(item.id, filters)}>{item.label}</Link>
                  <strong>{item.subtitle}</strong>
                </div>
                <p>{item.affectedScope}</p>
                <div className="risk-row__meta">
                  <span>
                    {copy.score} {item.riskScore}
                  </span>
                  <span>
                    {copy.delta} {formatScoreDelta(item.scoreDelta)}
                  </span>
                  <span>
                    {item.linkedIssueCount} {copy.linkedIssues}
                  </span>
                  <span>
                    {getRiskStateLabel(item.isNewRisk, item.isPersistentRisk, locale)}
                  </span>
                </div>

                {showReasonDetails ? (
                  <RiskReasonCards
                    embedded
                    entityId={item.id}
                    locale={locale}
                    reasons={item.reasons}
                    title={copy.riskDrivers}
                  />
                ) : null}
              </div>

              <div className="risk-row__actions">
                <Link className="timeline-button timeline-button--ghost" href={item.timelineHref}>
                  {copy.openInTimeline}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EntityDetail({
  entity,
  locale,
  filters,
}: {
  entity: RiskEntityDetail;
  locale: AppLocale;
  filters: ActiveFilters;
}) {
  const copy = COPY[locale];

  return (
    <section className="risk-detail">
      <div className="risk-detail__header">
        <div>
          <span className="eyebrow">{copy.drillDownEyebrow}</span>
          <h2 className="risk-panel__title">{entity.label}</h2>
          <p>{entity.subtitle}</p>
        </div>

        <div className="risk-detail__score">
          <span className={buildLevelClass(entity.riskLevel)}>
            {getRiskLevelLabel(entity.riskLevel, locale)}
          </span>
          <strong>{entity.riskScore}</strong>
          <span>
            {copy.delta.toLowerCase()} {formatScoreDelta(entity.scoreDelta)}
          </span>
        </div>
      </div>

      <div className="risk-detail__grid">
        <div className="risk-detail__section">
          <RiskReasonCards
            entityId={entity.id}
            locale={locale}
            reasons={entity.reasons}
            title={copy.whyRisky}
          />
        </div>

        <div className="risk-detail__section">
          <h3>{copy.trend}</h3>
          <div className="risk-trend">
            {entity.history.map((point) => (
              <article className="risk-trend__point" key={point.computedAt}>
                <span className={buildLevelClass(point.riskLevel)}>
                  {getRiskLevelLabel(point.riskLevel, locale)}
                </span>
                <strong>{point.riskScore}</strong>
                <p>{formatOptionalDateTime(point.computedAt, locale)}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="risk-detail__section">
        <div className="risk-detail__section-header">
          <h3>{copy.linkedIssuesTitle}</h3>
          <Link className="timeline-button timeline-button--ghost" href={entity.timelineHref}>
            {copy.openInTimeline}
          </Link>
        </div>

        {entity.linkedIssues.length === 0 ? (
          <div className="daily-brief-empty">{copy.noLinkedIssues}</div>
        ) : (
          <div className="risk-linked-issues">
            {entity.linkedIssues.map((issue) => (
              <article className="risk-linked-issue" key={issue.id}>
                <div className="risk-linked-issue__main">
                  <div className="risk-row__title">
                    <span className={buildLevelClass(issue.riskLevel)}>
                      {getRiskLevelLabel(issue.riskLevel, locale)}
                    </span>
                    <Link href={buildEntityHref(issue.id, filters)}>{issue.label}</Link>
                    <strong>{issue.subtitle}</strong>
                  </div>
                  <p>{issue.affectedScope}</p>
                  <div className="risk-row__meta">
                    <span>
                      {copy.score} {issue.riskScore}
                    </span>
                    <span>
                      {copy.delta} {formatScoreDelta(issue.scoreDelta)}
                    </span>
                    <span>
                      {getRiskStateLabel(issue.isNewRisk, issue.isPersistentRisk, locale)}
                    </span>
                  </div>
                  <RiskReasonCards
                    embedded
                    entityId={issue.id}
                    locale={locale}
                    reasons={issue.reasons}
                    title={copy.riskDrivers}
                  />
                </div>

                <div className="risk-row__actions">
                  <Link className="timeline-button timeline-button--ghost" href={issue.timelineHref}>
                    {copy.openInTimeline}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default async function RiskRadarPage({ searchParams }: RiskRadarPageProps) {
  noStore();

  const locale = await getAppLocale();
  const copy = COPY[locale];
  const resolvedSearchParams = (await searchParams) ?? {};
  const dashboard = await loadRiskRadarDashboard({
    project: firstQueryValue(resolvedSearchParams.project),
    component: firstQueryValue(resolvedSearchParams.component),
    assignee: firstQueryValue(resolvedSearchParams.assignee),
    entityId: firstQueryValue(resolvedSearchParams.entityId),
    locale,
  });
  const filters = dashboard.filters;

  return (
    <main className="page-shell">
      <section className="section-card risk-radar-page">
        <div className="section-header">
          <div className="section-header__main risk-radar-page__title-block">
            <div>
              <span className="eyebrow">{copy.eyebrow}</span>
              <h1 className="section-header__title">{copy.title}</h1>
              <p className="risk-radar-page__subtitle">{copy.subtitle}</p>
            </div>
          </div>

          <div className="section-header__side">
            <LanguageToggle locale={locale} />
            <Link className="timeline-button timeline-button--ghost" href="/">
              {copy.timeline}
            </Link>
            <Link className="timeline-button timeline-button--ghost" href="/daily-brief">
              {copy.dailyBrief}
            </Link>
            <ThemeToggle locale={locale} />
          </div>
        </div>

        <form className="risk-radar-filters" method="GET">
          <label className="timeline-field">
            <span>{copy.project}</span>
            <select defaultValue={filters.project} name="project">
              <option value="">{copy.allProjects}</option>
              {dashboard.filterOptions.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-field">
            <span>{copy.component}</span>
            <select defaultValue={filters.component} name="component">
              <option value="">{copy.allComponents}</option>
              {dashboard.filterOptions.components.map((component) => (
                <option key={component} value={component}>
                  {component}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-field">
            <span>{copy.assignee}</span>
            <select defaultValue={filters.assignee} name="assignee">
              <option value="">{copy.allAssignees}</option>
              {dashboard.filterOptions.assignees.map((assignee) => (
                <option key={assignee.key} value={assignee.key}>
                  {assignee.label}
                </option>
              ))}
            </select>
          </label>

          <div className="timeline-actions">
            <button className="timeline-button" type="submit">
              {copy.applyFilters}
            </button>
            <Link className="timeline-button timeline-button--ghost" href={buildResetHref()}>
              {copy.reset}
            </Link>
          </div>
        </form>

        <div className="risk-meta">
          <span>
            {copy.latestSnapshot}: {formatOptionalDateTime(dashboard.latestRunAt, locale)}
          </span>
          <span>
            {copy.previousSnapshot}: {formatOptionalDateTime(dashboard.previousRunAt, locale)}
          </span>
          <span>
            {copy.latestSync}:{" "}
            {dashboard.latestSync
              ? formatOptionalDateTime(dashboard.latestSync.finishedAt, locale)
              : getNotAvailableLabel(locale)}
          </span>
        </div>

        {dashboard.emptyStateMessage ? (
          <div className="empty-state">
            <span className="eyebrow">{copy.noRadarEyebrow}</span>
            <h3>{copy.noRadarTitle}</h3>
            <p>{dashboard.emptyStateMessage}</p>
            <p>
              {copy.endpoints} <code>GET /api/risk-radar/overview</code>,{" "}
              <code>GET /api/risk-radar/entities</code>,{" "}
              <code>POST /api/risk-radar/recompute</code>
            </p>
          </div>
        ) : (
          <>
            <div className="risk-summary-grid">
              <SummaryCard
                accent="danger"
                eyebrow={copy.summaryCards.issuesEyebrow}
                label={copy.summaryCards.issuesLabel}
                value={dashboard.overview.riskyIssuesCount}
              />
              <SummaryCard
                accent="warning"
                eyebrow={copy.summaryCards.epicsEyebrow}
                label={copy.summaryCards.epicsLabel}
                value={dashboard.overview.riskyEpicsCount}
              />
              <SummaryCard
                accent="danger"
                eyebrow={copy.summaryCards.hotspotsEyebrow}
                label={copy.summaryCards.hotspotsLabel}
                value={dashboard.overview.criticalHotspotsCount}
              />
              <SummaryCard
                eyebrow={copy.summaryCards.newEyebrow}
                label={copy.summaryCards.newLabel}
                value={dashboard.overview.newRisksCount}
              />
            </div>

            {dashboard.overview.projectSummary ? (
              <section className="risk-highlight">
                <div>
                  <span className="eyebrow">{copy.projectSummary}</span>
                  <h2>{dashboard.overview.projectSummary.label}</h2>
                  <p>{dashboard.overview.projectSummary.subtitle}</p>
                </div>
                <div className="risk-highlight__score">
                  <span className={buildLevelClass(dashboard.overview.projectSummary.riskLevel)}>
                    {getRiskLevelLabel(
                      dashboard.overview.projectSummary.riskLevel,
                      locale,
                    )}
                  </span>
                  <strong>{dashboard.overview.projectSummary.riskScore}</strong>
                </div>
              </section>
            ) : null}

            <div className="risk-panel-grid">
              <Distribution items={dashboard.overview.distribution} locale={locale} />
              <ReasonBreakdown items={dashboard.overview.reasonBreakdown} locale={locale} />
            </div>

            {dashboard.selectedEntity ? (
              <EntityDetail entity={dashboard.selectedEntity} filters={filters} locale={locale} />
            ) : null}

            <div className="risk-panel-stack">
              <EntityTable
                eyebrow={copy.tableEyebrows.epics}
                filters={filters}
                items={dashboard.overview.topEpics}
                locale={locale}
                title={copy.tableTitles.epics}
              />
              <EntityTable
                eyebrow={copy.tableEyebrows.issues}
                filters={filters}
                items={dashboard.overview.topIssues}
                locale={locale}
                showReasonDetails
                title={copy.tableTitles.issues}
              />
              <EntityTable
                eyebrow={copy.tableEyebrows.hotspots}
                filters={filters}
                items={dashboard.overview.hotspots}
                locale={locale}
                title={copy.tableTitles.hotspots}
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
