import { recomputeRiskSnapshots } from "@/modules/risk-radar/load-risk-radar";

type RecomputeBody = {
  jiraConnectionId?: string;
  projectId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RecomputeBody;
    const summary = await recomputeRiskSnapshots({
      jiraConnectionId: body.jiraConnectionId?.trim() || undefined,
      projectId: body.projectId?.trim() || undefined,
    });

    return Response.json({
      ok: true,
      ...summary,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to recompute risk radar snapshots.",
      },
      {
        status: 500,
      },
    );
  }
}
