import { prisma } from "@/modules/db/prisma";

export type IssueRow = {
  id: string;
  key: string;
  summary: string;
  status: string;
  issueType: string;
  priority: string | null;
  epicKey: string | null;
  epicSummary: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  projectKey: string;
  projectName: string;
  startedAt: Date | null;
  dueAt: Date | null;
  resolvedAt: Date | null;
  jiraUpdatedAt: Date | null;
};

export type IssuesPage = {
  issues: IssueRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export async function loadIssuesPage(params: {
  search?: string;
  page?: string;
  pageSize?: number;
}): Promise<IssuesPage> {
  const pageSize = params.pageSize ?? 50;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const search = (params.search ?? "").trim();

  const where = search
    ? { key: { contains: search, mode: "insensitive" as const } }
    : {};

  const [rows, totalCount] = await Promise.all([
    prisma.issue.findMany({
      where,
      orderBy: [{ key: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        epic: { select: { key: true, summary: true } },
        assignee: { select: { displayName: true, color: true } },
        project: { select: { key: true, name: true } },
      },
    }),
    prisma.issue.count({ where }),
  ]);

  const issues: IssueRow[] = rows.map((row) => ({
    id: row.id,
    key: row.key,
    summary: row.summary,
    status: row.status,
    issueType: row.issueType,
    priority: row.priority,
    epicKey: row.epic?.key ?? null,
    epicSummary: row.epic?.summary ?? null,
    assigneeName: row.assignee?.displayName ?? null,
    assigneeColor: row.assignee?.color ?? null,
    projectKey: row.project.key,
    projectName: row.project.name,
    startedAt: row.startedAt,
    dueAt: row.dueAt,
    resolvedAt: row.resolvedAt,
    jiraUpdatedAt: row.jiraUpdatedAt,
  }));

  return { issues, totalCount, page, pageSize };
}
