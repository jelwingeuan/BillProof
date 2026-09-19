import { readState } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("run");
  const state = await readState();
  const run = state.runs.find((item) => item.id === id);
  if (!run) return Response.json({ error: "Run report not found" }, { status: 404 });
  return new Response(JSON.stringify(run, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="billproof-${run.scenarioId}-${run.id}.json"`,
    },
  });
}
