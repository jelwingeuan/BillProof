import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { readJson, apiError } from "../lib/api";
import { localRequestError, localUrl } from "../lib/local-boundary";
import { demoProject } from "../lib/policy";
import { runScenario } from "../lib/runner";
import { DEMO_SCENARIOS } from "../lib/scenarios";
import { readState, saveProject, saveScenarios } from "../lib/store";
import { startSampleTarget } from "../scripts/sample-target";

test("local boundary rejects rebinding, cross-origin writes, remote targets and oversized JSON", async () => {
  assert.throws(() => localUrl("https://example.com"));
  assert.throws(() => localUrl("http://localhost@evil.example"));
  assert.throws(() => localUrl("http://127.0.0.1/path"));
  assert.equal(localUrl("http://127.0.0.1:4100"), "http://127.0.0.1:4100");
  const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/run", { headers });
  assert.ok(localRequestError(request({ host: "evil.example" })));
  assert.ok(localRequestError(request({ host: "localhost:3000", origin: "https://evil.example" })));
  assert.ok(localRequestError(request({ host: "localhost:3000", origin: "http://localhost:4000" })));
  assert.equal(localRequestError(request({ host: "localhost:3000", origin: "http://localhost:3000" })), undefined);
  await assert.rejects(readJson(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify("x".repeat(100_001)) })), (error) => apiError(error).status === 413);
});

test("concurrent storage edits preserve records, reject stale policy, and never reset corrupt data", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "billproof-hardening-")), "state.json");
  process.env.BILLPROOF_DATA_PATH = path;
  await Promise.all(Array.from({ length: 20 }, (_, i) => saveScenarios([{ ...DEMO_SCENARIOS[0], id: `import-${i}` }])));
  assert.equal((await readState()).scenarios.length, DEMO_SCENARIOS.length + 20);
  await Promise.all(Array.from({ length: 4 }, (_, i) => promisify(execFile)(process.execPath, ["--import", "tsx", "-e", `const {saveScenarios}=require('./lib/store.ts'); const {DEMO_SCENARIOS}=require('./lib/scenarios.ts'); saveScenarios([{...DEMO_SCENARIOS[0],id:'process-${i}'}]).catch(e=>{console.error(e);process.exitCode=1})`], { env: { ...process.env, BILLPROOF_DATA_PATH: path } })));
  assert.equal((await readState()).scenarios.length, DEMO_SCENARIOS.length + 24);
  const original = (await readState()).projects[0];
  await saveProject({ ...original, name: "Updated" });
  await assert.rejects(saveProject(original), /Policy changed/);
  const before = await readFile(path, "utf8");
  await assert.rejects(saveScenarios([DEMO_SCENARIOS[0], DEMO_SCENARIOS[0]]));
  assert.equal(await readFile(path, "utf8"), before);
  await writeFile(path, "invalid JSON");
  await assert.rejects(saveScenarios([DEMO_SCENARIOS[0]]));
  assert.equal(await readFile(path, "utf8"), "invalid JSON");
});

test("concurrent runs stay isolated, all reference scenarios pass, assertions are enforced and fixtures are released", async () => {
  const target = await startSampleTarget({ targetPort: 0, providerPort: 0 });
  const options = { project: demoProject(), targetUrl: target.targetUrl, providerUrl: target.providerUrl };
  try {
    const results = await Promise.all(DEMO_SCENARIOS.map((scenario) => runScenario({ ...options, scenario, mode: "corrected" })));
    for (const run of results) assert.equal(run.status, "pass", `${run.scenarioId}: ${run.error}`);
    const stale = DEMO_SCENARIOS.find((item) => item.id === "stale-pre-cancellation")!;
    const overlap = await Promise.all(Array.from({ length: 8 }, (_, i) => runScenario({ ...options, scenario: stale, mode: i % 2 ? "naive" : "corrected" })));
    overlap.forEach((run, i) => assert.equal(run.status, i % 2 ? "fail" : "pass"));
    const fixture = new URL(overlap[0].evidence.find((item) => item.method === "GET")!.url).searchParams.get("scenarioId");
    assert.equal((await fetch(`${target.targetUrl}/test/effects?scenarioId=${fixture}`)).status, 404);
    assert.equal((await fetch(`${target.providerUrl}/provider/state?scenarioId=${fixture}`)).status, 404);
    const asserted = await runScenario({ ...options, scenario: { ...DEMO_SCENARIOS[0], assertions: [{ kind: "access", featureId: "api", expectedAllowed: false }] }, mode: "corrected" });
    assert.equal(asserted.status, "fail");
    assert.ok(asserted.findings.some((item) => item.title === "Explicit scenario assertion failed"));
    assert.deepEqual(asserted.inputs?.project, options.project);
    const empty = await runScenario({ ...options, scenario: { ...DEMO_SCENARIOS[0], steps: [{ kind: "advance", seconds: 1 }] }, mode: "corrected" });
    assert.equal(empty.status, "error");
    assert.match(empty.error!, /No access or side-effect/);
    const retry = DEMO_SCENARIOS.find((item) => item.id === "transient-retry")!;
    const unrecovered = await runScenario({ ...options, scenario: { ...retry, steps: retry.steps.filter((step) => step.kind !== "delivery" || !step.retry) }, mode: "corrected" });
    assert.equal(unrecovered.status, "error");
    assert.match(unrecovered.error!, /failed without a successful retry/);
    const blocked = await fetch(`${target.targetUrl}/test/reset`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    assert.equal(blocked.status, 403);
  } finally { await target.stop(); }
});
