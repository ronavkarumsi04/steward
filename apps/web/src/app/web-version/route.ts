export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { commit: process.env.STEWARD_WEB_BUILD_COMMIT },
    { headers: { "cache-control": "no-store" } },
  );
}
