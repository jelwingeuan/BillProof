import type { EntitlementPolicy, Feature, Plan, Project, SubscriptionSnapshot } from "./types";

export const DEMO_START = "2026-01-01T00:00:00.000Z";

export const DEMO_FEATURES: Feature[] = [
  { id: "dashboard", label: "Dashboard", protectedPath: "/protected/dashboard" },
  { id: "exports", label: "Exports", protectedPath: "/protected/exports" },
  { id: "api", label: "API", protectedPath: "/protected/api" },
  { id: "collaboration", label: "Collaboration", protectedPath: "/protected/collaboration" },
];

export const DEMO_PLANS: Plan[] = [
  { id: "free", label: "Free", priceReference: "price_demo_free", featureIds: ["dashboard"] },
  { id: "pro", label: "Pro", priceReference: "price_demo_pro_monthly", featureIds: ["dashboard", "exports", "api"] },
  { id: "team", label: "Team", priceReference: "price_demo_team_monthly", featureIds: ["dashboard", "exports", "api", "collaboration"] },
];

export const DEFAULT_POLICY: EntitlementPolicy = {
  trialAccess: "purchased_plan",
  failedPaymentGraceSeconds: 3 * 24 * 60 * 60,
  accessDuringGrace: true,
  cancellationDefault: "period_end",
  upgradeTiming: "immediate",
  downgradeTiming: "period_end",
  convergenceDeadlineMs: 2_000,
};

export function demoProject(): Project {
  return {
    id: "demo-project",
    name: "Acme Analytics (local demo)",
    createdAt: DEMO_START,
    updatedAt: DEMO_START,
    features: DEMO_FEATURES,
    plans: DEMO_PLANS,
    policy: DEFAULT_POLICY,
  };
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1_000).toISOString();
}

export function effectivePlanId(snapshot: SubscriptionSnapshot, at: string): string {
  if (snapshot.pendingPlanId && snapshot.planChangeEffectiveAt && Date.parse(at) >= Date.parse(snapshot.planChangeEffectiveAt)) {
    return snapshot.pendingPlanId;
  }
  return snapshot.planId;
}

export function expectedFeatureIds(project: Project, snapshot: SubscriptionSnapshot, at: string): string[] {
  const freePlan = project.plans.find((plan) => plan.id === "free") ?? project.plans[0];
  const activePlan = project.plans.find((plan) => plan.id === effectivePlanId(snapshot, at)) ?? freePlan;
  let entitled = false;

  if (snapshot.status === "active") entitled = true;
  if (snapshot.status === "trialing") entitled = project.policy.trialAccess === "purchased_plan";
  if (snapshot.status === "past_due") {
    entitled = Boolean(snapshot.graceEndsAt && Date.parse(at) < Date.parse(snapshot.graceEndsAt) && project.policy.accessDuringGrace);
  }
  if (snapshot.status === "canceled") {
    const behavior = snapshot.cancellationBehavior ?? project.policy.cancellationDefault;
    entitled = Boolean(behavior === "period_end" && snapshot.currentPeriodEnd && Date.parse(at) < Date.parse(snapshot.currentPeriodEnd));
  }

  return (entitled ? activePlan : freePlan).featureIds;
}

export function expectedAccess(project: Project, snapshot: SubscriptionSnapshot, at: string, featureId: string): boolean {
  return expectedFeatureIds(project, snapshot, at).includes(featureId);
}
