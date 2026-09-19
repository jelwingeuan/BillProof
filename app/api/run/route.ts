import { NextResponse } from "next/server";
import { z } from "zod";
import { runScenario } from "../../../lib/runner";
import { readState, saveRun } from "../../../lib/store";

const RequestSchema = z.object({ scenarioId: z.string().min(1), mode: z.enum(["naive", "corrected"]) });

export async function POST(request: Request) {
  try {
    const input = RequestSchema.parse(await request.json());
    const state = await readState();
    const project = state.projects[0];
    const scenario = state.scenarios.find((item) => item.id === input.scenarioId);
    if (!project || !scenario) return NextResponse.json({ error: "Demo project or requested scenario was not found." }, { status: 404 });
    const run = await runScenario({ project, scenario, mode: input.mode });
    await saveRun(run);
    return NextResponse.json(run, { status: run.status === "error" ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Run request failed" }, { status: 400 });
  }
}
