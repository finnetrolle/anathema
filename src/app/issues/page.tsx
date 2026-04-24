import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { LanguageToggle } from "@/components/layout/language-toggle";
import { ThemeToggle } from "@/components/timeline/theme-toggle";
import type { AppLocale } from "@/modules/i18n/config";
import { formatOptionalDate } from "@/modules/i18n/presenter";
import { getAppLocale } from "@/modules/i18n/server";
import { loadIssuesPage } from "@/modules/issues/load-issues";

export const dynamic = "force-dynamic";

type IssuesPageProps = {
  searchParams?: Promise<{
    search?: string | string[];
    page?: string | string[];
  }>;
};

type IssuesCopy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  timeline: string;
  search: string;
  searchPlaceholder: string;
  find: string;
  reset: string;
  key: string;
  summary: string;
  status: string;
  type: string;
  priority: string;
  epic: string;
  assignee: string;
  project: string;
  started: string;
  due: string;
  resolved: string;
  updated: string;
  noIssues: string;
  noIssuesBody: string;
  prev: string;
  next: string;
  pageOf: (page: number, total: number) => string;
  showing: (from: number, to: number, total: number) => string;
};

const COPY: Record<AppLocale, IssuesCopy> = {
  ru: {
    eyebrow: "Реестр задач",
    title: "Все задачи",
    subtitle: "Полный список задач проекта с поиском по Jira ID.",
    timeline: "Таймлайн",
    search: "Поиск",
    searchPlaceholder: "PROJ-123",
    find: "Найти",
    reset: "Сбросить",
    key: "Ключ",
    summary: "Название",
    status: "Статус",
    type: "Тип",
    priority: "Приоритет",
    epic: "Эпик",
    assignee: "Исполнитель",
    project: "Проект",
    started: "Начата",
    due: "Дедлайн",
    resolved: "Решена",
    updated: "Обновлена",
    noIssues: "Задач пока нет",
    noIssuesBody: "Запустите синхронизацию Jira, чтобы задачи появились здесь.",
    prev: "Назад",
    next: "Вперёд",
    pageOf: (page, total) => `${page} из ${total}`,
    showing: (from, to, total) => `${from}\u2013${to} из ${total}`,
  },
  en: {
    eyebrow: "Issue Registry",
    title: "All Issues",
    subtitle: "Full list of project issues with search by Jira ID.",
    timeline: "Timeline",
    search: "Search",
    searchPlaceholder: "PROJ-123",
    find: "Find",
    reset: "Reset",
    key: "Key",
    summary: "Summary",
    status: "Status",
    type: "Type",
    priority: "Priority",
    epic: "Epic",
    assignee: "Assignee",
    project: "Project",
    started: "Started",
    due: "Due",
    resolved: "Resolved",
    updated: "Updated",
    noIssues: "No issues yet",
    noIssuesBody: "Run a Jira sync to populate issues here.",
    prev: "Previous",
    next: "Next",
    pageOf: (page, total) => `${page} of ${total}`,
    showing: (from, to, total) => `${from}\u2013${to} of ${total}`,
  },
};

function firstQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IssuesListPage({ searchParams }: IssuesPageProps) {
  noStore();

  const locale = await getAppLocale();
  const copy = COPY[locale];
  const resolvedSearchParams = (await searchParams) ?? {};
  const search = firstQueryValue(resolvedSearchParams.search) ?? "";
  const pageParam = firstQueryValue(resolvedSearchParams.page) ?? "1";

  const result = await loadIssuesPage({ search, page: pageParam });
  const totalPages = Math.max(1, Math.ceil(result.totalCount / result.pageSize));
  const from = (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.page * result.pageSize, result.totalCount);

  function buildPageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/issues?${qs}` : "/issues";
  }

  return (
    <main className="page-shell">
      <section className="section-card issues-page">
        <div className="section-header">
          <div className="section-header__main issues-page__title-block">
            <div>
              <span className="eyebrow">{copy.eyebrow}</span>
              <h1 className="section-header__title">{copy.title}</h1>
              <p className="issues-page__subtitle">{copy.subtitle}</p>
            </div>
          </div>

          <div className="section-header__side">
            <LanguageToggle locale={locale} />
            <Link className="timeline-button timeline-button--ghost" href="/">
              {copy.timeline}
            </Link>
            <ThemeToggle locale={locale} />
          </div>
        </div>

        <div className="issues-toolbar">
          <form className="issues-search" method="GET">
            <label className="timeline-field">
              <span>{copy.search}</span>
              <input
                autoComplete="off"
                defaultValue={search}
                name="search"
                placeholder={copy.searchPlaceholder}
                type="search"
              />
            </label>
            <div className="timeline-actions">
              <button className="timeline-button" type="submit">
                {copy.find}
              </button>
              <Link className="timeline-button timeline-button--ghost" href="/issues">
                {copy.reset}
              </Link>
            </div>
          </form>

          {result.totalCount > 0 && (
            <span className="issues-toolbar__count">
              {copy.showing(from, to, result.totalCount)}
            </span>
          )}
        </div>

        {result.issues.length === 0 ? (
          <div className="empty-state">
            <span className="eyebrow">{copy.noIssues}</span>
            <h3>{copy.noIssues}</h3>
            <p>{copy.noIssuesBody}</p>
          </div>
        ) : (
          <>
            <div className="issues-table-wrap">
              <table className="issues-table">
                <thead>
                  <tr>
                    <th>{copy.key}</th>
                    <th>{copy.summary}</th>
                    <th>{copy.status}</th>
                    <th>{copy.type}</th>
                    <th>{copy.priority}</th>
                    <th>{copy.epic}</th>
                    <th>{copy.assignee}</th>
                    <th>{copy.project}</th>
                    <th>{copy.updated}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues.map((issue) => (
                    <tr key={issue.id}>
                      <td className="issues-table__key">
                        <span>{issue.key}</span>
                      </td>
                      <td className="issues-table__summary">{issue.summary}</td>
                      <td>
                        <span className="issues-table__status">{issue.status}</span>
                      </td>
                      <td>{issue.issueType}</td>
                      <td>{issue.priority ?? "\u2014"}</td>
                      <td>
                        {issue.epicKey ? (
                          <span className="issues-table__epic">
                            {issue.epicKey}
                          </span>
                        ) : (
                          "\u2014"
                        )}
                      </td>
                      <td>
                        {issue.assigneeName ? (
                          <span className="issues-table__assignee">
                            {issue.assigneeColor ? (
                              <span
                                className="issues-table__avatar"
                                style={{ backgroundColor: issue.assigneeColor }}
                              />
                            ) : null}
                            {issue.assigneeName}
                          </span>
                        ) : (
                          "\u2014"
                        )}
                      </td>
                      <td>{issue.projectKey}</td>
                      <td className="issues-table__date">
                        {formatOptionalDate(issue.jiraUpdatedAt?.toISOString() ?? null, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav className="issues-pagination">
                {result.page > 1 ? (
                  <Link className="timeline-button timeline-button--ghost" href={buildPageHref(result.page - 1)}>
                    {copy.prev}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="issues-pagination__info">
                  {copy.pageOf(result.page, totalPages)}
                </span>
                {result.page < totalPages ? (
                  <Link className="timeline-button timeline-button--ghost" href={buildPageHref(result.page + 1)}>
                    {copy.next}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
