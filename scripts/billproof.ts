import { demoProject } from "../lib/policy";
import { runScenario } from "../lib/runner";
import { findScenario } from "../lib/scenarios";
import type { TargetMode } from "../lib/types";

function usage(): string {
  return "Usage: npm run cli -- --scenario <stable-scenario-id> --mode <naive|corrected> [--target http://127.0.0.1:4100] [--provider http://127.0.0.1:4101]";
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(usage());
  process.exit(0);
}
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const scenarioId = value("--scenario");
const candidateMode = value("--mode") ?? "corrected";
const mode: TargetMode | undefined = candidateMode === "naive" || candidateMode === "corrected" ? candidateMode : undefined;
const scenario = scenarioId ? findScenario(scenarioId) : undefined;
if (!scenario || !mode) {
  console.error(`${!scenario ? "Unknown or missing scenario. " : ""}${!mode ? "Mode must be naive or corrected. " : ""}${usage()}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const run = await runScenario({ project: demoProject(), scenario: scenario!, mode: mode!, targetUrl: value("--target"), providerUrl: value("--provider") });
  console.log(JSON.stringify({ id: run.id, status: run.status, findings: run.findings, error: run.error, reproductionCommand: run.reproductionCommand }, null, 2));
  process.exitCode = run.status === "pass" ? 0 : run.status === "fail" ? 1 : 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
