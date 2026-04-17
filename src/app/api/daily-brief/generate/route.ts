import { generateDailyBrief, loadDailyBriefDashboard } from "@/modules/daily-brief/load-daily-brief";

type GenerateDailyBriefRequest = {
  scopeType?: string;
  project?: string;
  person?: string;
  preset?: string;
  from?: string;
  to?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GenerateDailyBriefRequest;
  const dashboard = await loadDailyBriefDashboard({
    scopeType: body.scopeType,
    project: body.project,
    person: body.person,
    preset: body.preset,
    from: body.from,
    to: body.to,
  });

  if (!dashboard.scope || !dashboard.window) {
    return Response.json(
      {
        ok: false,
        message: "Unable to resolve daily brief scope.",
      },
      {
        status: 400,
      },
    );
  }

  const brief = await generateDailyBrief({
    scope: dashboard.scope,
    window: dashboard.window,
  });

  return Response.json({
    ok: true,
    brief,
  });
}
