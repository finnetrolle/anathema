import { unstable_noStore as noStore } from "next/cache";

import { ProjectFilter } from "@/components/timeline/project-filter";
import { SyncNowButton } from "@/components/timeline/sync-now-button";
import { ThemeToggle } from "@/components/timeline/theme-toggle";
import { TimelineBoard } from "@/components/timeline/timeline-board";
import { loadTimelineDashboard } from "@/modules/timeline/load-dashboard";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    from?: string | string[];
    to?: string | string[];
    dayWidth?: string | string[];
    project?: string | string[];
  }>;
};

function firstQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  noStore();

  const resolvedSearchParams = (await searchParams) ?? {};
  const dashboard = await loadTimelineDashboard({
    from: firstQueryValue(resolvedSearchParams.from),
    to: firstQueryValue(resolvedSearchParams.to),
    dayWidth: firstQueryValue(resolvedSearchParams.dayWidth),
    project: firstQueryValue(resolvedSearchParams.project),
  });

  return (
    <main className="page-shell">
      <section className="section-card">
        <div className="section-header">
          <div className="section-header__main">
            <h1 className="section-header__title">Anathema</h1>
          </div>

          <div className="section-header__side">
            <ThemeToggle />

            {dashboard.projectFilter.options.length > 0 ? (
              <ProjectFilter
                options={dashboard.projectFilter.options}
                selectedProjectId={dashboard.projectFilter.selectedProjectId}
              />
            ) : null}

            <details className="header-settings">
              <summary className="timeline-button timeline-button--ghost header-settings__toggle">
                Настройки
              </summary>

              <div className="header-settings__panel">
                <form className="timeline-filters timeline-filters--header" method="GET">
                  {dashboard.projectFilter.selectedProjectId ? (
                    <input
                      name="project"
                      type="hidden"
                      value={dashboard.projectFilter.selectedProjectId}
                    />
                  ) : null}

                  <label className="timeline-field">
                    <span>Start date</span>
                    <input
                      defaultValue={dashboard.rangeInputs.from}
                      name="from"
                      type="date"
                    />
                  </label>

                  <label className="timeline-field">
                    <span>End date</span>
                    <input
                      defaultValue={dashboard.rangeInputs.to}
                      name="to"
                      type="date"
                    />
                  </label>

                  <label className="timeline-field timeline-field--compact">
                    <span>Day width, px</span>
                    <input
                      defaultValue={dashboard.rangeInputs.dayWidth}
                      max={240}
                      min={48}
                      name="dayWidth"
                      step={1}
                      type="number"
                    />
                  </label>

                  <div className="timeline-actions">
                    <button className="timeline-button" type="submit">
                      Apply range
                    </button>
                    <a className="timeline-button timeline-button--ghost" href="/">
                      Reset
                    </a>
                  </div>
                </form>
              </div>
            </details>

            <SyncNowButton initialJql={dashboard.latestSync?.requestedJql} />
          </div>
        </div>

        {dashboard.timeline ? (
          <TimelineBoard timeline={dashboard.timeline} />
        ) : (
          <div className="empty-state">
            <span className="eyebrow">No Prisma Timeline Yet</span>
            <h3>Run a Jira sync to populate the board.</h3>
            <p>
              The page now reads only from PostgreSQL via Prisma. When the first
              sync succeeds, epics and issues will appear here automatically.
            </p>
            {dashboard.errorMessage ? (
              <p className="empty-state__error">{dashboard.errorMessage}</p>
            ) : null}
            <p>
              Endpoint for manual sync: <code>POST /api/jira/sync</code>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
