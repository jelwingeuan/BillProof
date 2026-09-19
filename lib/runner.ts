import { expectedAccess } from "./policy";
import { AdapterError, LocalHttpAdapter } from "./http-adapter";
import type { AccessObservation, DeliveryAttempt, Finding, HttpEvidence, Project, Scenario, ScenarioRun, TargetMode } from "./types";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function findingForAccess(observation: AccessObservation, customerId: string, evidenceLabel: string): Finding {
  const paidAccessWasRestored = !observation.expectedAllowed && observation.observedAllowed;
  return {
    id: id("finding"),
    severity: paidAccessWasRestored ? "high" : "medium",
    title: paidAccessWasRestored ? `Unexpected ${observation.featureId} access` : `Expected ${observation.featureId} access was denied`,
    customerId,
    featureId: observation.featureId,
    expected: observation.expectedAllowed ? "protected operation allowed" : "protected operation denied",
    observed: observation.observedAllowed ? "protected operation allowed" : "protected operation denied",
    rootCauseHypothesis: "Hypothesis: the target applied a delivered subscription snapshot instead of reconciling authoritative provider state at the observation time.",
    suggestedFix: "Record processed delivery IDs for side effects and reconcile the current subscription state under a transaction or concurrency guard before changing access.",
    evidenceLabels: [evidenceLabel],
  };
}

export async function runScenario(options: { project: Project; scenario: Scenario; mode: TargetMode; targetUrl?: string; providerUrl?: string }): Promise<ScenarioRun> {
  const { project, scenario, mode } = options;
  const adapter = new LocalHttpAdapter({ targetUrl: options.targetUrl, providerUrl: options.providerUrl, timeoutMs: project.policy.convergenceDeadlineMs });
  const startedAt = new Date().toISOString();
  let virtualAt = scenario.startAt;
  const evidence: HttpEvidence[] = [];
  const deliveryAttempts: DeliveryAttempt[] = [];
  const observations: AccessObservation[] = [];
  const findings: Finding[] = [];
  let authoritativeState: import("./types").SubscriptionSnapshot | undefined;

  const base = {
    id: id("run"), projectId: project.id, scenarioId: scenario.id, scenarioTitle: scenario.title, seed: scenario.seed, targetMode: mode,
    startedAt, virtualStartAt: scenario.startAt, reproductionCommand: `npm run cli -- --scenario ${scenario.id} --mode ${mode}`,
  };

  try {
    evidence.push(...await adapter.reset(scenario.id, scenario.customerId, mode, project));
    evidence.push(await adapter.advanceClock(scenario.id, virtualAt));

    for (const step of scenario.steps) {
      if (step.kind === "provider_state") {
        authoritativeState = step.snapshot;
        evidence.push(await adapter.setProviderState(scenario.id, step.snapshot));
        evidence.push(await adapter.advanceClock(scenario.id, virtualAt));
      }
      if (step.kind === "advance") {
        virtualAt = new Date(Date.parse(virtualAt) + step.seconds * 1_000).toISOString();
        evidence.push(await adapter.advanceClock(scenario.id, virtualAt));
      }
      if (step.kind === "delivery") {
        const result = await adapter.deliver(scenario.id, step.event, Boolean(step.retry));
        evidence.push(result.evidence);
        deliveryAttempts.push({
          id: id("delivery"), eventId: step.event.id, ordinal: deliveryAttempts.length + 1, deliveredAt: virtualAt,
          httpStatus: result.status, outcome: result.status >= 200 && result.status < 300 ? (step.retry ? "retry" : "delivered") : "failed",
        });
      }
      if (step.kind === "observe") {
        if (!authoritativeState) throw new Error("Scenario attempted access observation without authoritative provider state.");
        for (const feature of project.features) {
          const expectedAllowed = expectedAccess(project, authoritativeState, virtualAt, feature.id);
          const result = await adapter.probe(scenario.id, feature.id);
          evidence.push(result.evidence);
          const observation: AccessObservation = {
            checkpoint: step.checkpoint, observedAt: virtualAt, featureId: feature.id, expectedAllowed, observedAllowed: result.allowed,
            evidenceType: "protected_operation", httpStatus: result.evidence.responseStatus, response: result.evidence.responseBody,
          };
          observations.push(observation);
          if (expectedAllowed !== result.allowed) findings.push(findingForAccess(observation, scenario.customerId, result.evidence.label));
        }
      }
      if (step.kind === "effect_assert") {
        const result = await adapter.effectCount(scenario.id);
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

    return { ...base, status: findings.length ? "fail" : "pass", completedAt: new Date().toISOString(), virtualEndAt: virtualAt, deliveryAttempts, observations, findings, evidence };
  } catch (error) {
    if (error instanceof AdapterError && error.evidence) evidence.push(error.evidence);
    return {
      ...base, status: "error", completedAt: new Date().toISOString(), virtualEndAt: virtualAt, deliveryAttempts, observations, findings, evidence,
      error: error instanceof Error ? error.message : "Unknown scenario execution error",
    };
  }
}
