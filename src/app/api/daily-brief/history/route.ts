import { loadDailyBriefHistoryForApi } from "@/modules/daily-brief/load-daily-brief";

function firstQueryValue(value: string | string[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scopeType = firstQueryValue(searchParams.getAll("scopeType")) ?? undefined;
  const history = await loadDailyBriefHistoryForApi({
    scopeType,
    project: firstQueryValue(searchParams.getAll("project")) ?? undefined,
    person: firstQueryValue(searchParams.getAll("person")) ?? undefined,
  });

  return Response.json({
    ok: true,
    history,
  });
}
