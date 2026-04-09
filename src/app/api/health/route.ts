export async function GET() {
  return Response.json({
    ok: true,
    service: "anathema",
    timestamp: new Date().toISOString(),
  });
}

