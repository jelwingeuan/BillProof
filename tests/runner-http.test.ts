import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import { ScenarioRunSchema } from "../lib/types";
import { demoProject } from "../lib/policy";
import { runScenario } from "../lib/runner";
import { findScenario } from "../lib/scenarios";
import { readState, saveProject, saveRun } from "../lib/store";
import { startSampleTarget } from "../scripts/sample-target";

test("naive target fails stale evidence, reconciled target passes same seed, duplicate effect is once", async () => {
  process.env.BILLPROOF_DATA_PATH = join(await mkdtemp(join(tmpdir(), "billproof-test-")), "state.json");
  const target = await startSampleTarget({ targetPort: 0, providerPort: 0 });
  try {
    const health = await fetch(`${target.targetUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { ok: boolean; service: string; contractVersion: number };
    assert.equal(healthBody.service, "billproof-sample-target");
    assert.equal(healthBody.contractVersion, 2);

    const stale = findScenario("stale-pre-cancellation");
    const duplicate = findScenario("duplicate-payment-delivery");
    const retry = findScenario("transient-retry");
    assert.ok(stale); assert.ok(duplicate); assert.ok(retry);
    const project = demoProject();
    const naive = await runScenario({ project, scenario: stale, mode: "naive", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(naive.status, "fail");
    assert.ok(naive.observations.some((item) => item.featureId === "exports" && item.expectedAllowed === false && item.observedAllowed === true && item.httpStatus === 200));
    assert.ok(naive.evidence.filter((item) => item.label === "Probe protected exports operation").length > 1);
    assert.equal(naive.schemaVersion, 1);
    assert.equal(naive.contractVersion, 2);
    assert.equal(naive.runnerVersion, "0.2.0");

    const corrected = await runScenario({ project, scenario: stale, mode: "corrected", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(corrected.status, "pass");
    assert.equal(corrected.seed, naive.seed);

    const idempotent = await runScenario({ project: demoProject(), scenario: duplicate, mode: "corrected", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(idempotent.status, "pass");
    assert.ok(idempotent.evidence.some((item) => item.label === "Read protected side-effect count" && item.responseBody.includes("creditGrantCount\":1")));

    const retried = await runScenario({ project: demoProject(), scenario: retry, mode: "corrected", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(retried.status, "pass");
    assert.deepEqual(retried.deliveryAttempts.map((item) => item.httpStatus), [503, 200]);

    await saveRun(corrected);
    await saveRun({ ...corrected, id: "legacy-v1-run", contractVersion: 1 });
    const edited = { ...demoProject(), policy: { ...demoProject().policy, accessDuringGrace: false } };
    await saveProject(edited);
    const reloaded = await readState();
    assert.equal(reloaded.runs[0]?.contractVersion, 1);
    assert.equal(reloaded.runs[1]?.id, corrected.id);
    assert.equal(reloaded.projects[0]?.policy.accessDuringGrace, false);
  } finally { await target.stop(); }
});

test("unreachable target returns an error report", async () => {
  const scenario = findScenario("successful-checkout");
  assert.ok(scenario);
  const run = await runScenario({ project: demoProject(), scenario, mode: "corrected", targetUrl: "http://127.0.0.1:9", providerUrl: "http://127.0.0.1:9" });
  assert.equal(run.status, "error");
  assert.match(run.error ?? "", /Could not reach local target/);
});

test("provider readback rejects stale or malformed state with retained HTTP evidence", async () => {
  const original = findScenario("successful-checkout")!;
  const providerStep = original.steps.find((step) => step.kind === "provider_state")!;
  const scenario = { ...original, steps: [providerStep, { kind: "observe" as const, checkpoint: "provider readback" }], assertions: [] };
  const project = { ...demoProject(), features: [demoProject().features[0]], plans: demoProject().plans.map((plan) => ({ ...plan, featureIds: ["dashboard"] })) };
  let providerState: unknown;
  let protectedProbes = 0;
  const server = createServer((request, response) => {
    let body: unknown = { ok: true };
    if (request.method === "GET" && request.url?.startsWith("/provider/state?")) body = { state: providerState };
    if (request.method === "GET" && request.url?.startsWith("/protected/")) {
      protectedProbes++;
      body = { ok: true, featureId: "dashboard" };
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const { state, message } of [
      { state: { ...providerStep.snapshot, revision: 99 }, message: /does not match/ },
      { state: { ...providerStep.snapshot, revision: "invalid" }, message: /malformed subscription snapshot/ },
    ]) {
      providerState = state;
      protectedProbes = 0;
      const run = await runScenario({ project, scenario, mode: "corrected", targetUrl: url, providerUrl: url });
      assert.equal(run.status, "error");
      assert.match(run.error ?? "", message);
      assert.equal(protectedProbes, 0);
      const readback = run.evidence.find((item) => item.label === "Query authoritative provider state");
      assert.equal(readback?.responseStatus, 200);
      assert.equal(readback?.responseBody, JSON.stringify({ state }));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("convergence accepts delayed access, rejects persistent mismatch and late success, and retains cleanup warnings", async () => {
  const original = findScenario("successful-checkout")!;
  const providerStep = original.steps.find((step) => step.kind === "provider_state")!;
  const scenario = { ...original, steps: [providerStep, { kind: "observe" as const, checkpoint: "convergence" }], assertions: [] };
  const project = { ...demoProject(), features: [demoProject().features[0]], plans: demoProject().plans.map((plan) => ({ ...plan, featureIds: ["dashboard"] })), policy: { ...demoProject().policy, convergenceDeadlineMs: 250 } };
  let behavior: "delayed" | "mismatch" | "late" = "delayed";
  let probes = 0;
  const server = createServer((request, response) => {
    const send = (status: number, ok: boolean, featureId?: string) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify({ ok, ...(featureId ? { featureId } : {}) })); };
    if (request.method === "DELETE") return send(500, false);
    if (request.method === "GET" && request.url?.startsWith("/provider/state?")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ state: providerStep.snapshot }));
      return;
    }
    if (request.url?.startsWith("/protected/")) {
      probes++;
      if (behavior === "late" && probes > 1) { setTimeout(() => send(200, true, "dashboard"), 300); return; }
      const allowed = behavior === "delayed" && probes > 1;
      return send(allowed ? 200 : 403, allowed, "dashboard");
    }
    send(200, true);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const candidate of ["delayed", "mismatch", "late"] as const) {
      behavior = candidate;
      probes = 0;
      const run = await runScenario({ project, scenario, mode: "corrected", targetUrl: url, providerUrl: url });
      assert.equal(run.status, candidate === "delayed" ? "pass" : candidate === "mismatch" ? "fail" : "error");
      assert.ok(probes >= 2, "must retry a mismatched observation");
      assert.match(ScenarioRunSchema.parse(run).warnings?.[0] ?? "", /cleanup was rejected/);
      if (candidate === "late") assert.match(run.error ?? "", /Timed out|deadline/);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
