import { loadRiskRadarEntities } from "@/modules/risk-radar/load-risk-radar";

function firstQueryValue(value: string | string[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sort = firstQueryValue(searchParams.getAll("sort"));
  const entities = await loadRiskRadarEntities({
    project: firstQueryValue(searchParams.getAll("project")) ?? undefined,
    component: firstQueryValue(searchParams.getAll("component")) ?? undefined,
    assignee: firstQueryValue(searchParams.getAll("assignee")) ?? undefined,
    entityType: firstQueryValue(searchParams.getAll("entityType")) ?? undefined,
    sort: sort === "freshness" ? "freshness" : "score",
    limit: parsePositiveInteger(firstQueryValue(searchParams.getAll("limit"))),
  });

  return Response.json({
    ok: true,
    entities,
  });
}
