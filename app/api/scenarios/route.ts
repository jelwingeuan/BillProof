import { NextResponse } from "next/server";
import { ScenarioSchema } from "../../../lib/types";
import { saveScenario } from "../../../lib/store";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const candidates = Array.isArray(payload) ? payload : [payload];
    const scenarios = candidates.map((candidate) => ScenarioSchema.parse(candidate));
    for (const scenario of scenarios) await saveScenario(scenario);
    return NextResponse.json({ ok: true, scenarios });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scenario import failed" }, { status: 400 });
  }
}
