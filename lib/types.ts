import { z } from "zod";

export type RunStatus = "pass" | "fail" | "error" | "skipped";
export type TargetMode = "naive" | "corrected";

export const FeatureSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  protectedPath: z.string().regex(/^\/[a-z0-9/_-]+$/),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const PlanSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  priceReference: z.string().min(1),
  featureIds: z.array(z.string().min(1)).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

export const EntitlementPolicySchema = z.object({
  trialAccess: z.enum(["purchased_plan", "free"]),
  failedPaymentGraceSeconds: z.number().int().min(0),
  accessDuringGrace: z.boolean(),
  cancellationDefault: z.enum(["immediate", "period_end"]),
  upgradeTiming: z.enum(["immediate", "period_end"]),
  downgradeTiming: z.enum(["immediate", "period_end"]),
  convergenceDeadlineMs: z.number().int().min(100).max(30_000),
});
export type EntitlementPolicy = z.infer<typeof EntitlementPolicySchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  plans: z.array(PlanSchema).min(1).max(30),
  features: z.array(FeatureSchema).min(1).max(50),
  policy: EntitlementPolicySchema,
}).superRefine((project, context) => {
  const features = new Set(project.features.map((feature) => feature.id));
  if (features.size !== project.features.length || new Set(project.plans.map((plan) => plan.id)).size !== project.plans.length) context.addIssue({ code: "custom", message: "Plan and feature IDs must be unique." });
  if (!project.plans.some((plan) => plan.id === "free")) context.addIssue({ code: "custom", message: "An explicit free plan is required." });
  for (const plan of project.plans) {
    if (new Set(plan.featureIds).size !== plan.featureIds.length || plan.featureIds.some((id) => !features.has(id))) context.addIssue({ code: "custom", message: `Plan ${plan.id} has duplicate or unknown features.` });
  }
});
export type Project = z.infer<typeof ProjectSchema>;

export const SubscriptionSnapshotSchema = z.object({
  customerId: z.string().min(1),
  subscriptionId: z.string().min(1),
  planId: z.string().min(1),
  status: z.enum(["active", "trialing", "past_due", "canceled"]),
  currentPeriodEnd: z.string().datetime().optional(),
  trialEndsAt: z.string().datetime().optional(),
  graceEndsAt: z.string().datetime().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  cancellationBehavior: z.enum(["immediate", "period_end"]).optional(),
  pendingPlanId: z.string().min(1).optional(),
  planChangeEffectiveAt: z.string().datetime().optional(),
  refunded: z.boolean().default(false),
  revision: z.number().int().min(0),
});
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshotSchema>;

export const BillingEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "checkout.completed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
    "invoice.paid",
    "charge.refunded",
  ]),
  createdAt: z.string().datetime(),
  snapshot: SubscriptionSnapshotSchema,
  failFirstAttempt: z.boolean().optional(),
});
export type BillingEvent = z.infer<typeof BillingEventSchema>;

export const DeliveryAttemptSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  ordinal: z.number().int().positive(),
  deliveredAt: z.string().datetime(),
  httpStatus: z.number().int().nullable(),
  outcome: z.enum(["delivered", "retry", "failed", "error"]),
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

const ProviderStateStepSchema = z.object({ kind: z.literal("provider_state"), snapshot: SubscriptionSnapshotSchema });
const AdvanceStepSchema = z.object({ kind: z.literal("advance"), seconds: z.number().int().min(0) });
const DeliveryStepSchema = z.object({ kind: z.literal("delivery"), event: BillingEventSchema, retry: z.boolean().optional() });
const ObserveStepSchema = z.object({ kind: z.literal("observe"), checkpoint: z.string().min(1) });
const EffectStepSchema = z.object({ kind: z.literal("effect_assert"), effect: z.literal("credit_grant"), expectedCount: z.number().int().min(0) });
export const ScenarioStepSchema = z.discriminatedUnion("kind", [
  ProviderStateStepSchema,
  AdvanceStepSchema,
  DeliveryStepSchema,
  ObserveStepSchema,
  EffectStepSchema,
]);
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const AssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("access"), featureId: z.string().min(1), expectedAllowed: z.boolean() }),
  z.object({ kind: z.literal("effect_count"), effect: z.literal("credit_grant"), expectedCount: z.number().int().min(0) }),
]);
export type Assertion = z.infer<typeof AssertionSchema>;

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  seed: z.string().min(1),
  customerId: z.string().min(1),
  startAt: z.string().datetime(),
  steps: z.array(ScenarioStepSchema).min(1).max(100),
  assertions: z.array(AssertionSchema).max(50),
  tags: z.array(z.string().min(1)),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const AccessObservationSchema = z.object({
  checkpoint: z.string(),
  observedAt: z.string().datetime(),
  featureId: z.string(),
  expectedAllowed: z.boolean(),
  observedAllowed: z.boolean().nullable(),
  evidenceType: z.enum(["protected_operation", "target_claim", "unavailable"]),
  httpStatus: z.number().int().nullable(),
  response: z.string().max(1200),
});
export type AccessObservation = z.infer<typeof AccessObservationSchema>;

export const HttpEvidenceSchema = z.object({
  label: z.string(),
  method: z.string(),
  url: z.string(),
  requestSummary: z.string(),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().max(1200),
  elapsedMs: z.number().int().min(0),
});
export type HttpEvidence = z.infer<typeof HttpEvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  customerId: z.string(),
  featureId: z.string().optional(),
  expected: z.string(),
  observed: z.string(),
  rootCauseHypothesis: z.string(),
  suggestedFix: z.string(),
  evidenceLabels: z.array(z.string()),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ScenarioRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  scenarioId: z.string(),
  scenarioTitle: z.string(),
  seed: z.string(),
  targetMode: z.enum(["naive", "corrected"]),
  status: z.enum(["pass", "fail", "error", "skipped"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  virtualStartAt: z.string().datetime(),
  virtualEndAt: z.string().datetime(),
  deliveryAttempts: z.array(DeliveryAttemptSchema),
  observations: z.array(AccessObservationSchema),
  findings: z.array(FindingSchema),
  evidence: z.array(HttpEvidenceSchema),
  error: z.string().optional(),
  reproductionCommand: z.string(),
  inputs: z.object({ project: ProjectSchema, scenario: ScenarioSchema }).optional(),
});
export type ScenarioRun = z.infer<typeof ScenarioRunSchema>;

export const PersistedStateSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
  scenarios: z.array(ScenarioSchema),
  runs: z.array(ScenarioRunSchema),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;
