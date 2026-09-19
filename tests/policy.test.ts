import assert from "node:assert/strict";
import test from "node:test";
import { demoProject, expectedAccess } from "../lib/policy";
import type { SubscriptionSnapshot } from "../lib/types";

const base = (overrides: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({
  customerId: "cus_test", subscriptionId: "sub_test", planId: "pro", status: "active", revision: 1, cancelAtPeriodEnd: false, refunded: false, ...overrides,
});

test("policy applies grace and plan-change boundaries exactly in UTC", () => {
  const project = demoProject();
  const grace = base({ status: "past_due", graceEndsAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(expectedAccess(project, grace, "2026-01-01T23:59:59.999Z", "exports"), true);
  assert.equal(expectedAccess(project, grace, "2026-01-02T00:00:00.000Z", "exports"), false);

  const downgrade = base({ planId: "team", pendingPlanId: "pro", planChangeEffectiveAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(expectedAccess(project, downgrade, "2026-01-01T23:59:59.999Z", "collaboration"), true);
  assert.equal(expectedAccess(project, downgrade, "2026-01-02T00:00:00.000Z", "collaboration"), false);
});

test("immediate cancellation retains only explicitly free dashboard access", () => {
  const canceled = base({ status: "canceled", cancellationBehavior: "immediate" });
  assert.equal(expectedAccess(demoProject(), canceled, "2026-01-01T00:00:00.000Z", "dashboard"), true);
  assert.equal(expectedAccess(demoProject(), canceled, "2026-01-01T00:00:00.000Z", "api"), false);

  const periodEnd = base({ status: "canceled", cancellationBehavior: "period_end", currentPeriodEnd: "2026-01-02T00:00:00.000Z" });
  assert.equal(expectedAccess(demoProject(), periodEnd, "2026-01-01T23:59:59.999Z", "api"), true);
  assert.equal(expectedAccess(demoProject(), periodEnd, "2026-01-02T00:00:00.000Z", "api"), false);
});
