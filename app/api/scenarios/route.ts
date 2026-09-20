import { NextResponse } from "next/server";
import { ScenarioSchema } from "../../../lib/types";
import { saveScenarios } from "../../../lib/store";
import { apiError, readJson } from "../../../lib/api";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const candidates = Array.isArray(payload) ? payload : [payload];
    const scenarios = candidates.map((candidate) => ScenarioSchema.parse(candidate));
    await saveScenarios(scenarios);
    return NextResponse.json({ ok: true, scenarios });
  } catch (error) {
    return apiError(error);
  }
}
