import { loadRiskRadarOverviewForApi } from "@/modules/risk-radar/load-risk-radar";

function firstQueryValue(value: string | string[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const overview = await loadRiskRadarOverviewForApi({
    project: firstQueryValue(searchParams.getAll("project")) ?? undefined,
    component: firstQueryValue(searchParams.getAll("component")) ?? undefined,
    assignee: firstQueryValue(searchParams.getAll("assignee")) ?? undefined,
  });

  return Response.json({
    ok: true,
    overview,
  });
}
