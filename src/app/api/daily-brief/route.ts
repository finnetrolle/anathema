import { loadDailyBriefForApi } from "@/modules/daily-brief/load-daily-brief";

function firstQueryValue(value: string | string[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function readBooleanFlag(value: string | null) {
  return value === "1" || value === "true";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scopeType = firstQueryValue(searchParams.getAll("scopeType")) ?? undefined;
  const scopeKey = firstQueryValue(searchParams.getAll("scopeKey")) ?? undefined;
  const project = firstQueryValue(searchParams.getAll("project")) ?? undefined;
  const person = firstQueryValue(searchParams.getAll("person")) ?? undefined;
  const preset = firstQueryValue(searchParams.getAll("preset")) ?? undefined;
  const brief = await loadDailyBriefForApi({
    scopeType,
    scopeKey,
    project,
    person,
    preset,
    from: firstQueryValue(searchParams.getAll("from")) ?? undefined,
    to: firstQueryValue(searchParams.getAll("to")) ?? undefined,
    regenerate: readBooleanFlag(searchParams.get("regenerate")),
    actionableOnly: readBooleanFlag(searchParams.get("actionableOnly")),
  });

  if (!brief) {
    return Response.json(
      {
        ok: false,
        message: "Daily brief is not available for the selected scope.",
      },
      {
        status: 404,
      },
    );
  }

  return Response.json({
    ok: true,
    brief,
  });
}
