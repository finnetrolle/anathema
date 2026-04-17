import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { ThemeToggle } from "@/components/timeline/theme-toggle";
import { loadDailyBriefDashboard } from "@/modules/daily-brief/load-daily-brief";
import type { DailyBriefViewItem } from "@/modules/daily-brief/types";

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

function firstQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "n/a";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatDate(value: string | null) {
  if (!value) {
    return "n/a";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(parsed);
}

function formatEstimate(item: DailyBriefViewItem) {
  const values = [
    item.details.estimateHours === null ? null : `${item.details.estimateHours}h`,
    item.details.estimateStoryPoints === null
      ? null
      : `${item.details.estimateStoryPoints} SP`,
  ].filter((value): value is string => Boolean(value));

  return values.length > 0 ? values.join(" · ") : "No estimate";
}

function Section({
  title,
  eyebrow,
  items,
}: {
  title: string;
  eyebrow: string;
  items: DailyBriefViewItem[];
}) {
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
        <div className="daily-brief-empty">
          Nothing landed in this section for the selected brief.
        </div>
      ) : (
        <div className="daily-brief-list">
          {items.map((item) => (
            <article className="daily-brief-item" key={item.id}>
              <div className="daily-brief-item__main">
                <div className="daily-brief-item__title-row">
                  <span
                    className={`daily-brief-chip daily-brief-chip--${item.importance.toLowerCase()}`}
                  >
                    {item.importance}
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

                <p className="daily-brief-item__reason">{item.details.reason}</p>

                <div className="daily-brief-item__meta">
                  <span>{item.assigneeName}</span>
                  <span>
                    {item.projectKey} · {item.projectName}
                  </span>
                  <span>{item.componentName}</span>
                  <span>{item.epicKey ?? "No epic"}</span>
                </div>
              </div>

              <dl className="daily-brief-item__facts">
                <div>
                  <dt>Status</dt>
                  <dd>{item.details.status}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatDate(item.details.startAt)}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{formatDate(item.details.dueAt)}</dd>
                </div>
                <div>
                  <dt>Resolved</dt>
                  <dd>{formatDate(item.details.resolvedAt)}</dd>
                </div>
                <div>
                  <dt>Estimate</dt>
                  <dd>{formatEstimate(item)}</dd>
                </div>
                <div>
                  <dt>Dev activity</dt>
                  <dd>
                    {item.details.pullRequestCount} PR · {item.details.commitCount} commits
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

  return (
    <main className="page-shell">
      <section className="section-card daily-brief-page">
        <div className="section-header">
          <div className="section-header__main daily-brief-page__title-block">
            <div>
              <span className="eyebrow">Async Standup</span>
              <h1 className="section-header__title">Daily Brief</h1>
              <p className="daily-brief-page__subtitle">
                Morning snapshot of what started, finished, got stuck, or needs attention.
              </p>
            </div>
          </div>

          <div className="section-header__side">
            <Link className="timeline-button timeline-button--ghost" href="/">
              Timeline
            </Link>
            <ThemeToggle />
          </div>
        </div>

        <form className="daily-brief-filters" method="GET">
          <label className="timeline-field">
            <span>Scope</span>
            <select defaultValue={dashboard.filters.scopeType} name="scopeType">
              <option value="TEAM">Team</option>
              <option value="PROJECT">Project</option>
              <option value="PERSON">Person</option>
            </select>
          </label>

          <label className="timeline-field">
            <span>Project</span>
            <select defaultValue={dashboard.filters.project} name="project">
              <option value="">All / n/a</option>
              {dashboard.scopeOptions.projects.map((project) => (
                <option key={project.key} value={project.key}>
                  {project.label}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-field">
            <span>Person</span>
            <select defaultValue={dashboard.filters.person} name="person">
              <option value="">All / n/a</option>
              {dashboard.scopeOptions.people.map((person) => (
                <option key={person.key} value={person.key}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-field">
            <span>Window</span>
            <select defaultValue={dashboard.filters.preset} name="preset">
              <option value="PREVIOUS_BUSINESS_DAY">Since previous business day</option>
              <option value="LAST_24H">Last 24h</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>

          <label className="timeline-field">
            <span>From</span>
            <input defaultValue={dashboard.filters.from} name="from" type="date" />
          </label>

          <label className="timeline-field">
            <span>To</span>
            <input defaultValue={dashboard.filters.to} name="to" type="date" />
          </label>

          <label className="daily-brief-checkbox">
            <input
              defaultChecked={dashboard.filters.actionableOnly}
              name="actionableOnly"
              type="checkbox"
              value="1"
            />
            <span>Only actionable items</span>
          </label>

          <div className="timeline-actions">
            <button className="timeline-button" type="submit">
              Apply
            </button>
            <Link className="timeline-button timeline-button--ghost" href="/daily-brief">
              Reset
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
              Regenerate
            </Link>
          </div>
        </form>

        {dashboard.brief ? (
          <div className="daily-brief-layout">
            <div className="daily-brief-main">
              <section className="daily-brief-summary">
                <div className="daily-brief-summary__content">
                  <div>
                    <span className="eyebrow">{dashboard.brief.scope.label}</span>
                    <h2 className="daily-brief-summary__title">
                      {dashboard.brief.summary.headline}
                    </h2>
                    <p className="daily-brief-summary__meta">
                      Window: {formatDateTime(dashboard.brief.summary.windowStart)} -{" "}
                      {formatDateTime(dashboard.brief.summary.windowEnd)}
                    </p>
                    <p className="daily-brief-summary__meta">
                      Generated: {formatDateTime(dashboard.brief.updatedAt)}
                    </p>
                  </div>

                  <div className="daily-brief-stats">
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.completedCount}</strong>
                      <span>Completed</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.startedCount}</strong>
                      <span>Started</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.attentionCount}</strong>
                      <span>Attention</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.ownershipChangesCount}</strong>
                      <span>Handoffs</span>
                    </div>
                    <div className="daily-brief-stat">
                      <strong>{dashboard.brief.summary.counts.peopleCovered}</strong>
                      <span>People</span>
                    </div>
                  </div>
                </div>
              </section>

              <Section
                eyebrow="Delivery"
                items={dashboard.brief.sections.completed}
                title="Completed Since Last Brief"
              />
              <Section
                eyebrow="Flow"
                items={dashboard.brief.sections.started}
                title="Started / Moved Into Progress"
              />
              <Section
                eyebrow="Attention"
                items={dashboard.brief.sections.needsAttention}
                title="Needs Attention"
              />
              <Section
                eyebrow="Ownership"
                items={dashboard.brief.sections.ownershipChanges}
                title="Ownership Changes"
              />
              <Section
                eyebrow="Standup"
                items={dashboard.brief.sections.topicsForStandup}
                title="Topics For Standup"
              />
            </div>

            <aside className="daily-brief-sidebar">
              <section className="daily-brief-panel">
                <span className="eyebrow">Latest Sync</span>
                {dashboard.latestSync ? (
                  <dl className="daily-brief-sidebar__facts">
                    <div>
                      <dt>Status</dt>
                      <dd>{dashboard.latestSync.status}</dd>
                    </div>
                    <div>
                      <dt>Fetched</dt>
                      <dd>{dashboard.latestSync.issuesFetched}</dd>
                    </div>
                    <div>
                      <dt>Finished</dt>
                      <dd>{formatDateTime(dashboard.latestSync.finishedAt)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="daily-brief-empty">No successful sync yet.</p>
                )}
              </section>

              <section className="daily-brief-panel">
                <span className="eyebrow">People Covered</span>
                {dashboard.brief.summary.people.length > 0 ? (
                  <div className="daily-brief-tag-list">
                    {dashboard.brief.summary.people.map((person) => (
                      <span className="daily-brief-tag" key={person}>
                        {person}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="daily-brief-empty">No people in this brief.</p>
                )}
              </section>

              <section className="daily-brief-panel">
                <span className="eyebrow">History</span>
                {dashboard.history.length > 0 ? (
                  <div className="daily-brief-history">
                    {dashboard.history.map((entry) => (
                      <article className="daily-brief-history__item" key={entry.id}>
                        <strong>{formatDateTime(entry.generatedForDate)}</strong>
                        <p>{entry.headline}</p>
                        <span>
                          {entry.counts.completedCount} done · {entry.counts.startedCount} started
                          · {entry.counts.attentionCount} attention
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="daily-brief-empty">No saved brief history yet.</p>
                )}
              </section>
            </aside>
          </div>
        ) : (
          <div className="empty-state">
            <span className="eyebrow">No Daily Brief Yet</span>
            <h3>Run a Jira sync or choose a scope to generate the first brief.</h3>
            <p>
              The brief is built from persisted Jira issues, changelog history, due dates, and
              code activity signals after a successful sync.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
