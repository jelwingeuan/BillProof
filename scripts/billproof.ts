import { readFile } from "node:fs/promises";
import { runScenario } from "../lib/runner";
import { readState } from "../lib/store";
import { ScenarioRunSchema } from "../lib/types";
import type { TargetMode } from "../lib/types";

function usage(): string {
  return "Usage: npm run cli -- --scenario <saved-scenario-id> --mode <naive|corrected> OR --report <downloaded-report.json> [--target http://127.0.0.1:4100] [--provider http://127.0.0.1:4101]";
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
if ((!scenarioId && !value("--report")) || !mode) {
  console.error(usage());
  process.exit(2);
}

async function main(): Promise<void> {
  const reportPath = value("--report");
  const report = reportPath ? ScenarioRunSchema.parse(JSON.parse(await readFile(reportPath, "utf8"))) : undefined;
  if (report && !report.inputs) throw new Error("This legacy report has no saved inputs. Replay a newly downloaded report.");
  const state = report ? undefined : await readState();
  const project = report?.inputs?.project ?? state?.projects[0];
  const scenario = report?.inputs?.scenario ?? state?.scenarios.find((item) => item.id === scenarioId);
  if (!project || !scenario) throw new Error("Saved project or scenario not found.");
  const run = await runScenario({ project, scenario, mode: report?.targetMode ?? mode!, targetUrl: value("--target"), providerUrl: value("--provider") });
  console.log(JSON.stringify({ id: run.id, status: run.status, findings: run.findings, error: run.error, reproductionCommand: run.reproductionCommand }, null, 2));
  process.exitCode = run.status === "pass" ? 0 : run.status === "fail" ? 1 : 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
