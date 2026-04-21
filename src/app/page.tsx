import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { LanguageToggle } from "@/components/layout/language-toggle";
import { ProjectFilter } from "@/components/timeline/project-filter";
import { SyncNowButton } from "@/components/timeline/sync-now-button";
import { ThemeToggle } from "@/components/timeline/theme-toggle";
import { TimelineBoard } from "@/components/timeline/timeline-board";
import { getAppLocale } from "@/modules/i18n/server";
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

  const locale = await getAppLocale();
  const resolvedSearchParams = (await searchParams) ?? {};
  const dashboard = await loadTimelineDashboard({
    from: firstQueryValue(resolvedSearchParams.from),
    to: firstQueryValue(resolvedSearchParams.to),
    dayWidth: firstQueryValue(resolvedSearchParams.dayWidth),
    project: firstQueryValue(resolvedSearchParams.project),
    locale,
  });
  const copy =
    locale === "ru"
      ? {
          dailyBrief: "Ежедневный бриф",
          riskRadar: "Радар рисков",
          settings: "Настройки",
          startDate: "Дата начала",
          endDate: "Дата конца",
          dayWidth: "Ширина дня, px",
          applyRange: "Применить диапазон",
          reset: "Сбросить",
          noTimelineEyebrow: "Таймлайн ещё не заполнен",
          noTimelineTitle: "Запусти синхронизацию Jira, чтобы заполнить доску.",
          noTimelineBody:
            "Страница теперь читает данные только из PostgreSQL через Prisma. После первой успешной синхронизации эпики и задачи появятся здесь автоматически.",
          manualSyncEndpoint: "Ручной endpoint для синхронизации:",
        }
      : {
          dailyBrief: "Daily brief",
          riskRadar: "Risk radar",
          settings: "Settings",
          startDate: "Start date",
          endDate: "End date",
          dayWidth: "Day width, px",
          applyRange: "Apply range",
          reset: "Reset",
          noTimelineEyebrow: "No Prisma Timeline Yet",
          noTimelineTitle: "Run a Jira sync to populate the board.",
          noTimelineBody:
            "The page now reads only from PostgreSQL via Prisma. When the first sync succeeds, epics and issues will appear here automatically.",
          manualSyncEndpoint: "Endpoint for manual sync:",
        };

  return (
    <main className="page-shell">
      <section className="section-card">
        <div className="section-header">
          <div className="section-header__main">
            <h1 className="section-header__title">Anathema</h1>
          </div>

          <div className="section-header__side">
            <LanguageToggle locale={locale} />
            <ThemeToggle locale={locale} />

            <Link className="timeline-button timeline-button--ghost" href="/daily-brief">
              {copy.dailyBrief}
            </Link>

            <Link className="timeline-button timeline-button--ghost" href="/risk-radar">
              {copy.riskRadar}
            </Link>

            {dashboard.projectFilter.options.length > 0 ? (
              <ProjectFilter
                locale={locale}
                options={dashboard.projectFilter.options}
                selectedProjectId={dashboard.projectFilter.selectedProjectId}
              />
            ) : null}

            <details className="header-settings">
              <summary className="timeline-button timeline-button--ghost header-settings__toggle">
                {copy.settings}
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
                    <span>{copy.startDate}</span>
                    <input
                      defaultValue={dashboard.rangeInputs.from}
                      name="from"
                      type="date"
                    />
                  </label>

                  <label className="timeline-field">
                    <span>{copy.endDate}</span>
                    <input
                      defaultValue={dashboard.rangeInputs.to}
                      name="to"
                      type="date"
                    />
                  </label>

                  <label className="timeline-field timeline-field--compact">
                    <span>{copy.dayWidth}</span>
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
                      {copy.applyRange}
                    </button>
                    <Link className="timeline-button timeline-button--ghost" href="/">
                      {copy.reset}
                    </Link>
                  </div>
                </form>
              </div>
            </details>

            <SyncNowButton
              initialJql={dashboard.latestSync?.requestedJql}
              locale={locale}
            />
          </div>
        </div>

        {dashboard.timeline ? (
          <TimelineBoard locale={locale} timeline={dashboard.timeline} />
        ) : (
          <div className="empty-state">
            <span className="eyebrow">{copy.noTimelineEyebrow}</span>
            <h3>{copy.noTimelineTitle}</h3>
            <p>{copy.noTimelineBody}</p>
            {dashboard.errorMessage ? (
              <p className="empty-state__error">{dashboard.errorMessage}</p>
            ) : null}
            <p>
              {copy.manualSyncEndpoint} <code>POST /api/jira/sync</code>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
