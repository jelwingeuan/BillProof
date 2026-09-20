import { setTimeout as delay } from "node:timers/promises";
import { expectedAccess } from "./policy";
import { AdapterError, BILLPROOF_CONTRACT_VERSION, LocalHttpAdapter } from "./http-adapter";
import type { AccessObservation, DeliveryAttempt, Finding, HttpEvidence, Project, Scenario, ScenarioRun, TargetMode } from "./types";

export const BILLPROOF_RUNNER_VERSION = "0.2.0";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function findingForAccess(observation: AccessObservation, customerId: string, evidenceLabel: string): Finding {
  const unexpectedAccess = !observation.expectedAllowed && observation.observedAllowed;
  return {
    id: id("finding"),
    severity: unexpectedAccess ? "high" : "medium",
    title: unexpectedAccess ? `Unexpected ${observation.featureId} access` : `Expected ${observation.featureId} access was denied`,
    customerId,
    featureId: observation.featureId,
    expected: observation.expectedAllowed ? "protected operation allowed" : "protected operation denied",
    observed: observation.observedAllowed ? "protected operation allowed" : "protected operation denied",
    rootCauseHypothesis: unexpectedAccess
      ? "Hypothesis: the target retained stale paid access instead of reconciling authoritative provider state at the observation time."
      : "Hypothesis: the target has not yet applied the current paid entitlement, or rejected it while handling a billing update.",
    suggestedFix: unexpectedAccess
      ? "Reconcile current provider state before granting access, and make stale or duplicate deliveries unable to restore an older entitlement."
      : "Check the latest provider snapshot and webhook outcome, then apply the entitlement update atomically before serving protected operations.",
    evidenceLabels: [evidenceLabel],
  };
}

export async function runScenario(options: { project: Project; scenario: Scenario; mode: TargetMode; targetUrl?: string; providerUrl?: string }): Promise<ScenarioRun> {
  const { project, scenario, mode } = options;
  const fixtureId = id("fixture");
  let adapter: LocalHttpAdapter | undefined;
  const startedAt = new Date().toISOString();
  let virtualAt = scenario.startAt;
  const evidence: HttpEvidence[] = [];
  const deliveryAttempts: DeliveryAttempt[] = [];
  const observations: AccessObservation[] = [];
  const findings: Finding[] = [];
  const warnings: string[] = [];
  let authoritativeState: import("./types").SubscriptionSnapshot | undefined;

  const base = {
    id: id("run"), projectId: project.id, scenarioId: scenario.id, scenarioTitle: scenario.title, seed: scenario.seed, targetMode: mode,
    schemaVersion: 1 as const, runnerVersion: BILLPROOF_RUNNER_VERSION, contractVersion: BILLPROOF_CONTRACT_VERSION as 1,
    warnings,
    startedAt, virtualStartAt: scenario.startAt, reproductionCommand: `npm run cli -- --scenario ${scenario.id} --mode ${mode}`,
    inputs: { project: structuredClone(project), scenario: structuredClone(scenario) },
  };

  try {
    adapter = new LocalHttpAdapter({ targetUrl: options.targetUrl, providerUrl: options.providerUrl, timeoutMs: project.policy.convergenceDeadlineMs });
    evidence.push(...await adapter.reset(fixtureId, scenario.customerId, mode, project));
    evidence.push(await adapter.advanceClock(fixtureId, virtualAt));

    for (const step of scenario.steps) {
      if (step.kind === "provider_state") {
        authoritativeState = step.snapshot;
        if (!project.plans.some((plan) => plan.id === step.snapshot.planId) || (step.snapshot.pendingPlanId && !project.plans.some((plan) => plan.id === step.snapshot.pendingPlanId))) throw new Error("Scenario references an unknown plan.");
        evidence.push(await adapter.setProviderState(fixtureId, step.snapshot));
        evidence.push(await adapter.advanceClock(fixtureId, virtualAt));
      }
      if (step.kind === "advance") {
        virtualAt = new Date(Date.parse(virtualAt) + step.seconds * 1_000).toISOString();
        evidence.push(await adapter.advanceClock(fixtureId, virtualAt));
      }
      if (step.kind === "delivery") {
        const result = await adapter.deliver(fixtureId, step.event, Boolean(step.retry));
        evidence.push(result.evidence);
        deliveryAttempts.push({
          id: id("delivery"), eventId: step.event.id, ordinal: deliveryAttempts.length + 1, deliveredAt: virtualAt,
          httpStatus: result.status, outcome: result.status >= 200 && result.status < 300 ? (step.retry ? "retry" : "delivered") : "failed",
        });
      }
      if (step.kind === "observe") {
        if (!authoritativeState) throw new Error("Scenario attempted access observation without authoritative provider state.");
        const expected = new Map(project.features.map((feature) => [feature.id, expectedAccess(project, authoritativeState!, virtualAt, feature.id)]));
        const latest = new Map<string, Awaited<ReturnType<LocalHttpAdapter["probe"]>>>();
        const convergenceEndsAt = Date.now() + project.policy.convergenceDeadlineMs;
        let pending = project.features;
        do {
          const activeAdapter = adapter;
          const round = await Promise.allSettled(pending.map(async (feature) => ({ feature, result: await activeAdapter.probe(fixtureId, feature.id, feature.protectedPath, convergenceEndsAt) })));
          for (const item of round) {
            if (item.status === "rejected") continue;
            const { feature, result } = item.value;
            latest.set(feature.id, result);
            evidence.push(result.evidence);
          }
          const failed = round.find((item) => item.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          pending = project.features.filter((feature) => latest.get(feature.id)?.allowed !== expected.get(feature.id));
          const remaining = convergenceEndsAt - Date.now();
          if (pending.length && remaining > 0) await delay(Math.min(100, remaining));
          else break;
        } while (pending.length && Date.now() < convergenceEndsAt);

        for (const feature of project.features) {
          const expectedAllowed = expected.get(feature.id)!;
          const result = latest.get(feature.id)!;
          const observation: AccessObservation = {
            checkpoint: step.checkpoint, observedAt: virtualAt, featureId: feature.id, expectedAllowed, observedAllowed: result.allowed,
            evidenceType: "protected_operation", httpStatus: result.evidence.responseStatus, response: result.evidence.responseBody,
          };
          observations.push(observation);
          if (expectedAllowed !== result.allowed) findings.push(findingForAccess(observation, scenario.customerId, result.evidence.label));
        }
      }
      if (step.kind === "effect_assert") {
        const result = await adapter.effectCount(fixtureId);
        evidence.push(result.evidence);
        if (result.count !== step.expectedCount) {
          findings.push({
            id: id("finding"), severity: "high", title: "Duplicate business effect detected", customerId: scenario.customerId,
            expected: `${step.effect} count ${step.expectedCount}`, observed: `${step.effect} count ${result.count}`,
            rootCauseHypothesis: "Hypothesis: the target did not persist a processed event ID before applying the credit side effect.",
            suggestedFix: "Persist an idempotency record keyed by event ID in the same transaction as the business effect, then make retries no-ops.",
            evidenceLabels: [result.evidence.label],
          });
        }
      }
    }

    for (const assertion of scenario.assertions) {
      let expected: string;
      let observed: string;
      if (assertion.kind === "access") {
        const observation = observations.findLast((item) => item.featureId === assertion.featureId);
        if (!observation) throw new Error(`Assertion requires an observation for ${assertion.featureId}.`);
        expected = String(assertion.expectedAllowed);
        observed = String(observation.observedAllowed);
      } else {
        const result = await adapter.effectCount(fixtureId);
        evidence.push(result.evidence);
        expected = String(assertion.expectedCount);
        observed = String(result.count);
      }
      if (expected !== observed) findings.push({ id: id("finding"), severity: "high", title: "Explicit scenario assertion failed", customerId: scenario.customerId, expected, observed, rootCauseHypothesis: "The final observed result differs from the imported assertion.", suggestedFix: "Review the scenario assertion and captured target behavior.", evidenceLabels: evidence.map((item) => item.label) });
    }
    if (!observations.length && !scenario.steps.some((step) => step.kind === "effect_assert") && !scenario.assertions.some((assertion) => assertion.kind === "effect_count")) throw new Error("No access or side-effect checks were performed; this scenario cannot pass.");
    const unresolved = deliveryAttempts.filter((attempt) => attempt.outcome === "failed" && !deliveryAttempts.some((later) => later.eventId === attempt.eventId && later.ordinal > attempt.ordinal && (later.outcome === "delivered" || later.outcome === "retry")));
    if (unresolved.length) throw new Error("A delivery failed without a successful retry.");
    return { ...base, status: findings.length ? "fail" : "pass", completedAt: new Date().toISOString(), virtualEndAt: virtualAt, deliveryAttempts, observations, findings, evidence };
  } catch (error) {
    if (error instanceof AdapterError && error.evidence) evidence.push(error.evidence);
    return {
      ...base, status: "error", completedAt: new Date().toISOString(), virtualEndAt: virtualAt, deliveryAttempts, observations, findings, evidence,
      error: error instanceof Error ? error.message : "Unknown scenario execution error",
    };
  } finally {
    await adapter?.cleanup(fixtureId).catch((error) => {
      warnings.push(`Could not release local fixture: ${error instanceof Error ? error.message : "unknown error"}. Restart the sample target to clear its fixtures.`);
    });
  }
}
