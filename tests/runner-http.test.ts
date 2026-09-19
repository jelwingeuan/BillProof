import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    assert.deepEqual((await health.json() as { ok: boolean; service: string }).service, "billproof-sample-target");

    const stale = findScenario("stale-pre-cancellation");
    const duplicate = findScenario("duplicate-payment-delivery");
    const retry = findScenario("transient-retry");
    assert.ok(stale); assert.ok(duplicate); assert.ok(retry);
    const naive = await runScenario({ project: demoProject(), scenario: stale, mode: "naive", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(naive.status, "fail");
    assert.ok(naive.observations.some((item) => item.featureId === "exports" && item.expectedAllowed === false && item.observedAllowed === true && item.httpStatus === 200));

    const corrected = await runScenario({ project: demoProject(), scenario: stale, mode: "corrected", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(corrected.status, "pass");
    assert.equal(corrected.seed, naive.seed);

    const idempotent = await runScenario({ project: demoProject(), scenario: duplicate, mode: "corrected", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(idempotent.status, "pass");
    assert.ok(idempotent.evidence.some((item) => item.label === "Read protected side-effect count" && item.responseBody.includes("creditGrantCount\":1")));

    const retried = await runScenario({ project: demoProject(), scenario: retry, mode: "corrected", targetUrl: target.targetUrl, providerUrl: target.providerUrl });
    assert.equal(retried.status, "pass");
    assert.deepEqual(retried.deliveryAttempts.map((item) => item.httpStatus), [503, 200]);

    await saveRun(corrected);
    const edited = { ...demoProject(), policy: { ...demoProject().policy, accessDuringGrace: false } };
    await saveProject(edited);
    const reloaded = await readState();
    assert.equal(reloaded.runs[0]?.id, corrected.id);
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
