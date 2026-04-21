import { loadRiskRadarEntityDetailBySnapshotId } from "@/modules/risk-radar/load-risk-radar";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const entity = await loadRiskRadarEntityDetailBySnapshotId(id);

  if (!entity) {
    return Response.json(
      {
        ok: false,
        message: "Risk entity not found in the latest snapshot batch.",
      },
      {
        status: 404,
      },
    );
  }

  return Response.json({
    ok: true,
    entity,
  });
}
