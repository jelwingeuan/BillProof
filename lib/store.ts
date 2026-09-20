import { mkdir, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { demoProject } from "./policy";
import { DEMO_SCENARIOS } from "./scenarios";
import { PersistedStateSchema, ProjectSchema, ScenarioRunSchema, ScenarioSchema, type PersistedState, type Project, type Scenario, type ScenarioRun } from "./types";

function storePath(): string {
  return process.env.BILLPROOF_DATA_PATH ?? join(process.cwd(), "data", "billproof.json");
}

function initialState(): PersistedState {
  return structuredClone({ version: 1, projects: [demoProject()], scenarios: DEMO_SCENARIOS, runs: [] });
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
      return initialState();
    }
    throw error;
  }
}

async function writeState(state: PersistedState): Promise<void> {
  const parsed = PersistedStateSchema.parse(state);
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function mutateState(change: (state: PersistedState) => void): Promise<void> {
  const lock = `${storePath()}.lock`;
  await mkdir(dirname(lock), { recursive: true });
  const deadline = Date.now() + 5_000;
  // ponytail: one local filesystem lock; use a transactional database for multi-host operation.
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("Storage is busy. Retry; if this persists, stop BillProof and follow the lock recovery steps in README.md.");
      await delay(25);
    }
  }
  try {
    const state = await readState();
    change(state);
    await writeState(state);
  } finally { await rmdir(lock); }
}

export async function saveRun(run: ScenarioRun): Promise<void> {
  const checked = ScenarioRunSchema.parse(run);
  await mutateState((state) => { state.runs = [checked, ...state.runs.filter((item) => item.id !== checked.id)].slice(0, 100); });
}

export async function saveProject(project: Project): Promise<Project> {
  const checked = ProjectSchema.parse(project);
  await mutateState((state) => {
    const index = state.projects.findIndex((item) => item.id === checked.id);
    if (index < 0) state.projects.push(checked);
    else {
      if (state.projects[index].updatedAt !== checked.updatedAt) throw new Error("Policy changed in another window. Reload before saving again.");
      checked.updatedAt = new Date(Math.max(Date.now(), Date.parse(checked.updatedAt) + 1)).toISOString();
      state.projects[index] = checked;
    }
  });
  return checked;
}

export async function saveScenario(scenario: Scenario): Promise<Scenario> {
  return (await saveScenarios([scenario]))[0];
}

export async function saveScenarios(scenarios: Scenario[]): Promise<Scenario[]> {
  const checked = scenarios.map((scenario) => ScenarioSchema.parse(scenario));
  if (!checked.length || checked.length > 50 || new Set(checked.map((item) => item.id)).size !== checked.length) throw new Error("Import 1–50 scenarios with unique IDs.");
  await mutateState((state) => {
    for (const scenario of checked) {
      const index = state.scenarios.findIndex((item) => item.id === scenario.id);
      if (index < 0) state.scenarios.push(scenario);
      else state.scenarios[index] = scenario;
    }
    if (state.scenarios.length > 200) throw new Error("Local catalogue is limited to 200 scenarios.");
  });
  return checked;
}
