import { addSeconds, DEMO_START } from "./policy";
import type { BillingEvent, Scenario, SubscriptionSnapshot } from "./types";

const customerId = "cus_demo_ada";
const subscriptionId = "sub_demo_ada";
const DAY = 86_400;
const at = (seconds: number) => addSeconds(DEMO_START, seconds);

function snapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    customerId,
    subscriptionId,
    planId: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    refunded: false,
    revision: 1,
    ...overrides,
  };
}

function event(id: string, type: BillingEvent["type"], state: SubscriptionSnapshot, createdAt = at(10), failFirstAttempt = false): BillingEvent {
  return { id, type, createdAt, snapshot: state, ...(failFirstAttempt ? { failFirstAttempt } : {}) };
}

function scenario(id: string, title: string, description: string, steps: Scenario["steps"], tags: string[]): Scenario {
  return { id, title, description, seed: "billproof-demo-v1", customerId, startAt: DEMO_START, steps, assertions: [], tags };
}

const activePro = snapshot({ revision: 1, currentPeriodEnd: at(30 * DAY) });

export const DEMO_SCENARIOS: Scenario[] = [
  scenario("successful-checkout", "Successful checkout grants purchased access", "Active Pro checkout must enable Pro protected operations but not Team collaboration.", [
    { kind: "provider_state", snapshot: activePro },
    { kind: "delivery", event: event("evt_checkout_001", "checkout.completed", activePro) },
    { kind: "observe", checkpoint: "after checkout" },
  ], ["checkout", "baseline"]),
  scenario("trial-conversion", "Trial access and conversion", "Team trial follows policy and conversion to paid preserves intended access.", [
    { kind: "provider_state", snapshot: snapshot({ planId: "team", status: "trialing", trialEndsAt: at(7 * DAY), revision: 1 }) },
    { kind: "delivery", event: event("evt_trial_001", "customer.subscription.updated", snapshot({ planId: "team", status: "trialing", trialEndsAt: at(7 * DAY), revision: 1 })) },
    { kind: "observe", checkpoint: "during trial" },
    { kind: "advance", seconds: 7 * DAY },
    { kind: "provider_state", snapshot: snapshot({ planId: "team", status: "active", revision: 2 }) },
    { kind: "delivery", event: event("evt_trial_paid_001", "invoice.paid", snapshot({ planId: "team", status: "active", revision: 2 }), at(7 * DAY + 10)) },
    { kind: "observe", checkpoint: "after conversion" },
  ], ["trial", "conversion"]),
  scenario("failed-renewal-grace", "Failed renewal respects the grace boundary", "Pro remains available inside configured grace and is denied at the exact expiry boundary.", [
    { kind: "provider_state", snapshot: activePro },
    { kind: "delivery", event: event("evt_grace_active", "checkout.completed", activePro) },
    { kind: "provider_state", snapshot: snapshot({ status: "past_due", graceEndsAt: at(3 * DAY), revision: 2 }) },
    { kind: "delivery", event: event("evt_payment_failed", "invoice.payment_failed", snapshot({ status: "past_due", graceEndsAt: at(3 * DAY), revision: 2 })) },
    { kind: "observe", checkpoint: "inside grace" },
    { kind: "advance", seconds: 3 * DAY },
    { kind: "observe", checkpoint: "at grace expiry" },
  ], ["payment-failure", "boundary"]),
  scenario("payment-recovery", "Recovery during grace", "A successful payment while within grace restores or preserves Pro access.", [
    { kind: "provider_state", snapshot: snapshot({ status: "past_due", graceEndsAt: at(3 * DAY), revision: 1 }) },
    { kind: "delivery", event: event("evt_recovery_failed", "invoice.payment_failed", snapshot({ status: "past_due", graceEndsAt: at(3 * DAY), revision: 1 })) },
    { kind: "advance", seconds: DAY },
    { kind: "provider_state", snapshot: snapshot({ status: "active", revision: 2 }) },
    { kind: "delivery", event: event("evt_recovery_paid", "invoice.paid", snapshot({ status: "active", revision: 2 }), at(DAY + 10)) },
    { kind: "observe", checkpoint: "after recovery" },
  ], ["payment-recovery"]),
  scenario("period-end-cancellation", "Period-end cancellation", "Paid access lasts until the period ends, then Free dashboard remains.", [
    { kind: "provider_state", snapshot: snapshot({ currentPeriodEnd: at(DAY), cancelAtPeriodEnd: true, revision: 1 }) },
    { kind: "delivery", event: event("evt_cancel_scheduled", "customer.subscription.updated", snapshot({ currentPeriodEnd: at(DAY), cancelAtPeriodEnd: true, revision: 1 })) },
    { kind: "observe", checkpoint: "before period end" },
    { kind: "advance", seconds: DAY },
    { kind: "provider_state", snapshot: snapshot({ status: "canceled", currentPeriodEnd: at(DAY), cancellationBehavior: "period_end", revision: 2 }) },
    { kind: "observe", checkpoint: "at period end" },
  ], ["cancellation", "boundary"]),
  scenario("immediate-cancellation", "Immediate cancellation", "Immediate cancellation removes paid operations and retains only Free access.", [
    { kind: "provider_state", snapshot: activePro },
    { kind: "delivery", event: event("evt_immediate_start", "checkout.completed", activePro) },
    { kind: "provider_state", snapshot: snapshot({ status: "canceled", cancellationBehavior: "immediate", revision: 2 }) },
    { kind: "delivery", event: event("evt_immediate_cancel", "customer.subscription.deleted", snapshot({ status: "canceled", cancellationBehavior: "immediate", revision: 2 })) },
    { kind: "observe", checkpoint: "after immediate cancellation" },
  ], ["cancellation"]),
  scenario("upgrade-immediate", "Upgrade grants added features", "Pro-to-Team upgrade grants collaboration at the configured immediate point.", [
    { kind: "provider_state", snapshot: activePro },
    { kind: "delivery", event: event("evt_upgrade_pro", "checkout.completed", activePro) },
    { kind: "provider_state", snapshot: snapshot({ planId: "team", revision: 2 }) },
    { kind: "delivery", event: event("evt_upgrade_team", "customer.subscription.updated", snapshot({ planId: "team", revision: 2 })) },
    { kind: "observe", checkpoint: "after upgrade" },
  ], ["plan-change", "upgrade"]),
  scenario("downgrade-period-end", "Downgrade removes access at period end", "Team retains collaboration before the scheduled downgrade and loses it exactly at its effective time.", [
    { kind: "provider_state", snapshot: snapshot({ planId: "team", revision: 1 }) },
    { kind: "delivery", event: event("evt_downgrade_team", "checkout.completed", snapshot({ planId: "team", revision: 1 })) },
    { kind: "provider_state", snapshot: snapshot({ planId: "team", pendingPlanId: "pro", planChangeEffectiveAt: at(DAY), revision: 2 }) },
    { kind: "delivery", event: event("evt_downgrade_scheduled", "customer.subscription.updated", snapshot({ planId: "team", pendingPlanId: "pro", planChangeEffectiveAt: at(DAY), revision: 2 })) },
    { kind: "observe", checkpoint: "before downgrade" },
    { kind: "advance", seconds: DAY },
    { kind: "observe", checkpoint: "at downgrade boundary" },
  ], ["plan-change", "downgrade", "boundary"]),
  scenario("duplicate-payment-delivery", "Duplicate payment delivery", "The exact same payment event ID is delivered twice; corrected mode grants one credit effect.", [
    { kind: "provider_state", snapshot: activePro },
    { kind: "delivery", event: event("evt_duplicate_payment", "invoice.paid", activePro) },
    { kind: "delivery", event: event("evt_duplicate_payment", "invoice.paid", activePro), retry: true },
    { kind: "observe", checkpoint: "after duplicate delivery" },
    { kind: "effect_assert", effect: "credit_grant", expectedCount: 1 },
  ], ["duplicate", "idempotency"]),
  scenario("out-of-order-update", "Out-of-order event cannot overwrite authoritative state", "A stale Pro snapshot follows a newer Team update with tied timestamps; provider reconciliation keeps Team access.", [
    { kind: "provider_state", snapshot: snapshot({ planId: "team", revision: 2 }) },
    { kind: "delivery", event: event("evt_newer_team", "customer.subscription.updated", snapshot({ planId: "team", revision: 2 }), at(10)) },
    { kind: "delivery", event: event("evt_stale_pro", "customer.subscription.updated", snapshot({ planId: "pro", revision: 1 }), at(10)) },
    { kind: "observe", checkpoint: "after out-of-order update" },
  ], ["out-of-order", "tied-timestamps"]),
  scenario("transient-retry", "Transient failure and retry converge", "The first handler response is transient failure; retrying the same event converges to intended access.", [
    { kind: "provider_state", snapshot: activePro },
    { kind: "delivery", event: event("evt_retry_once", "invoice.paid", activePro, at(10), true) },
    { kind: "delivery", event: event("evt_retry_once", "invoice.paid", activePro, at(10), true), retry: true },
    { kind: "observe", checkpoint: "after successful retry" },
    { kind: "effect_assert", effect: "credit_grant", expectedCount: 1 },
  ], ["retry", "transient"]),
  scenario("stale-pre-cancellation", "Stale pre-cancellation event", "A cancellation is delivered before an obsolete active update at the same event timestamp; paid access must not return.", [
    { kind: "provider_state", snapshot: snapshot({ status: "canceled", cancellationBehavior: "immediate", revision: 3 }) },
    { kind: "delivery", event: event("evt_cancel_newer", "customer.subscription.deleted", snapshot({ status: "canceled", cancellationBehavior: "immediate", revision: 3 }), at(10)) },
    { kind: "delivery", event: event("evt_active_stale", "customer.subscription.updated", snapshot({ status: "active", planId: "pro", revision: 1 }), at(10)) },
    { kind: "observe", checkpoint: "after stale pre-cancellation delivery" },
  ], ["out-of-order", "cancellation", "tied-timestamps", "demo-failure"]),
];

export function findScenario(id: string): Scenario | undefined {
  return DEMO_SCENARIOS.find((item) => item.id === id);
}
