import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { demoProject } from "./policy";
import { DEMO_SCENARIOS } from "./scenarios";
import { PersistedStateSchema, ProjectSchema, ScenarioRunSchema, ScenarioSchema, type PersistedState, type Project, type Scenario, type ScenarioRun } from "./types";

function storePath(): string {
  return process.env.BILLPROOF_DATA_PATH ?? join(process.cwd(), "data", "billproof.json");
}

function initialState(): PersistedState {
  return { version: 1, projects: [demoProject()], scenarios: DEMO_SCENARIOS, runs: [] };
}

export async function readState(): Promise<PersistedState> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = PersistedStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error(`Stored data is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`);
    return parsed.data;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const state = initialState();
      await writeState(state);
      return state;
    }
    throw error;
  }
}

export async function writeState(state: PersistedState): Promise<void> {
  const parsed = PersistedStateSchema.parse(state);
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function saveRun(run: ScenarioRun): Promise<void> {
  const checked = ScenarioRunSchema.parse(run);
  const state = await readState();
  state.runs = [checked, ...state.runs].slice(0, 100);
  await writeState(state);
}

export async function saveProject(project: Project): Promise<Project> {
  const checked = ProjectSchema.parse(project);
  const state = await readState();
  const index = state.projects.findIndex((item) => item.id === checked.id);
  if (index < 0) state.projects.push(checked);
  else state.projects[index] = checked;
  await writeState(state);
  return checked;
}

export async function saveScenario(scenario: Scenario): Promise<Scenario> {
  const checked = ScenarioSchema.parse(scenario);
  const state = await readState();
  const index = state.scenarios.findIndex((item) => item.id === checked.id);
  if (index < 0) state.scenarios.push(checked);
  else state.scenarios[index] = checked;
  await writeState(state);
  return checked;
}
