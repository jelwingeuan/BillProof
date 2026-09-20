import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BillingEventSchema, ProjectSchema, SubscriptionSnapshotSchema, type Project, type SubscriptionSnapshot, type TargetMode } from "../lib/types";
import { localRequestError } from "../lib/local-boundary";

type TargetFixture = {
  mode: TargetMode;
  project: Project;
  now: string;
  snapshot?: SubscriptionSnapshot;
  featureIds: string[];
  processedEventIds: Set<string>;
  transientFailures: Set<string>;
  creditGrantCount: number;
};


function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function json(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request body exceeds 100KB local target limit.");
  }
  return body ? JSON.parse(body) : {};
}

function keyFrom(request: IncomingMessage): string | undefined {
  return new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("scenarioId") ?? undefined;
}

function sampleTargetFeatures(project: Project, snapshot: SubscriptionSnapshot, at: string): string[] {
  // Deliberately independent from lib/policy.ts: this represents the customer app's own logic.
  const freePlan = project.plans.find((plan) => plan.id === "free") ?? project.plans[0];
  const effectivePlanId = snapshot.pendingPlanId && snapshot.planChangeEffectiveAt && Date.parse(at) >= Date.parse(snapshot.planChangeEffectiveAt)
    ? snapshot.pendingPlanId
    : snapshot.planId;
  const paidPlan = project.plans.find((plan) => plan.id === effectivePlanId) ?? freePlan;
  let usePaidPlan = false;
  if (snapshot.status === "active") usePaidPlan = true;
  if (snapshot.status === "trialing") usePaidPlan = project.policy.trialAccess === "purchased_plan";
  if (snapshot.status === "past_due") usePaidPlan = Boolean(snapshot.graceEndsAt && Date.parse(at) < Date.parse(snapshot.graceEndsAt) && project.policy.accessDuringGrace);
  if (snapshot.status === "canceled") {
    const behavior = snapshot.cancellationBehavior ?? project.policy.cancellationDefault;
    usePaidPlan = Boolean(behavior === "period_end" && snapshot.currentPeriodEnd && Date.parse(at) < Date.parse(snapshot.currentPeriodEnd));
  }
  if (snapshot.status === "trialing" && snapshot.trialEndsAt && Date.parse(at) >= Date.parse(snapshot.trialEndsAt)) usePaidPlan = false;
  if (snapshot.cancelAtPeriodEnd && snapshot.currentPeriodEnd && Date.parse(at) >= Date.parse(snapshot.currentPeriodEnd)) usePaidPlan = false;
  return (usePaidPlan ? paidPlan : freePlan).featureIds;
}

async function reconcile(fixtureKey: string, providerUrl: string, targetFixtures: Map<string, TargetFixture>): Promise<void> {
  const fixture = targetFixtures.get(fixtureKey);
  if (!fixture) return;
  const response = await fetch(`${providerUrl}/provider/state?scenarioId=${encodeURIComponent(fixtureKey)}`, { signal: AbortSignal.timeout(2_000), redirect: "error" });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Provider read failed with ${response.status}.`);
  const payload = await response.json();
  const state = SubscriptionSnapshotSchema.parse((payload as { state?: unknown }).state);
  fixture.snapshot = state;
  fixture.featureIds = sampleTargetFeatures(fixture.project, state, fixture.now);
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not determine local listener port."));
      resolve(address.port);
    });
  });
}

export async function startSampleTarget(options: { targetPort?: number; providerPort?: number } = {}): Promise<{
  targetUrl: string;
  providerUrl: string;
  stop: () => Promise<void>;
}> {
  const providerFixtures = new Map<string, SubscriptionSnapshot>();
  const targetFixtures = new Map<string, TargetFixture>();
  function guard(request: IncomingMessage): string | undefined {
    const headers = new Headers();
    for (const name of ["host", "origin", "sec-fetch-site"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    return localRequestError(new Request("http://127.0.0.1", { headers }));
  }
  const provider = createServer(async (request, response) => {
    try {
      const error = guard(request);
      if (error) return send(response, 403, { error });
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "DELETE" && url.pathname === "/provider/state") {
        providerFixtures.delete(keyFrom(request) ?? "");
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/provider/reset") {
        const body = await json(request) as { scenarioId?: unknown };
        if (typeof body.scenarioId !== "string") return send(response, 400, { error: "scenarioId is required" });
        providerFixtures.delete(body.scenarioId);
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/provider/state") {
        const body = await json(request) as { scenarioId?: unknown; state?: unknown };
        if (typeof body.scenarioId !== "string") return send(response, 400, { error: "scenarioId is required" });
        const parsed = SubscriptionSnapshotSchema.safeParse(body.state);
        if (!parsed.success) return send(response, 400, { error: "Invalid subscription snapshot", issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
        providerFixtures.set(body.scenarioId, parsed.data);
        return send(response, 200, { ok: true, revision: parsed.data.revision });
      }
      if (request.method === "GET" && url.pathname === "/provider/state") {
        const scenarioId = url.searchParams.get("scenarioId");
        const state = scenarioId ? providerFixtures.get(scenarioId) : undefined;
        return state ? send(response, 200, { state }) : send(response, 404, { error: "No provider state for isolated scenario fixture" });
      }
      return send(response, 404, { error: "Unknown local provider route" });
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : "Invalid provider request" });
    }
  });
  const providerPort = await listen(provider, options.providerPort ?? Number(process.env.BILLPROOF_PROVIDER_PORT ?? 4101));
  const providerUrl = `http://127.0.0.1:${providerPort}`;

  const target = createServer(async (request, response) => {
    try {
      const error = guard(request);
      if (error) return send(response, 403, { error });
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "DELETE" && url.pathname === "/test/fixture") {
        targetFixtures.delete(keyFrom(request) ?? "");
        return send(response, 200, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return send(response, 200, {
          ok: true,
          service: "billproof-sample-target",
          provider: providerUrl,
          modes: ["naive", "corrected"],
        });
      }
      if (request.method === "POST" && url.pathname === "/test/reset") {
        const body = await json(request) as { scenarioId?: unknown; mode?: unknown; project?: unknown };
        const project = ProjectSchema.safeParse(body.project);
        if (typeof body.scenarioId !== "string" || (body.mode !== "naive" && body.mode !== "corrected") || !project.success) {
          return send(response, 400, { error: "scenarioId, mode, and valid project are required" });
        }
        targetFixtures.set(body.scenarioId, {
          mode: body.mode, project: project.data, now: "2026-01-01T00:00:00.000Z", snapshot: undefined, featureIds: [],
          processedEventIds: new Set(), transientFailures: new Set(), creditGrantCount: 0,
        });
        return send(response, 200, { ok: true, mode: body.mode });
      }
      if (request.method === "POST" && url.pathname === "/test/clock") {
        const body = await json(request) as { scenarioId?: unknown; at?: unknown };
        const fixture = typeof body.scenarioId === "string" ? targetFixtures.get(body.scenarioId) : undefined;
        if (!fixture || typeof body.at !== "string" || Number.isNaN(Date.parse(body.at))) return send(response, 400, { error: "Known scenarioId and ISO UTC at are required" });
        fixture.now = new Date(body.at).toISOString();
        if (fixture.mode === "corrected") await reconcile(body.scenarioId as string, providerUrl, targetFixtures);
        return send(response, 200, { ok: true, at: fixture.now });
      }
      if (request.method === "POST" && url.pathname === "/webhooks") {
        const body = await json(request) as { scenarioId?: unknown; event?: unknown; retry?: unknown };
        const fixture = typeof body.scenarioId === "string" ? targetFixtures.get(body.scenarioId) : undefined;
        const parsed = BillingEventSchema.safeParse(body.event);
        if (!fixture || !parsed.success) return send(response, 400, { error: "Known scenarioId and valid simulated billing event are required" });
        const item = parsed.data;
        if (item.failFirstAttempt && !fixture.transientFailures.has(item.id)) {
          fixture.transientFailures.add(item.id);
          return send(response, 503, { error: "Simulated transient handler failure", retryable: true });
        }
        if (fixture.mode === "corrected" && fixture.processedEventIds.has(item.id)) return send(response, 200, { ok: true, deduplicated: true });
        if (fixture.mode === "corrected") {
          await reconcile(body.scenarioId as string, providerUrl, targetFixtures);
          fixture.processedEventIds.add(item.id);
        } else {
          // Deliberate demo fault: apply the received historical snapshot, regardless of current provider state or duplicate ID.
          fixture.snapshot = item.snapshot;
          fixture.featureIds = sampleTargetFeatures(fixture.project, item.snapshot, fixture.now);
        }
        if (item.type === "invoice.paid") fixture.creditGrantCount += 1;
        return send(response, 200, { ok: true, retry: Boolean(body.retry), reconciled: fixture.mode === "corrected" });
      }
      if (request.method === "GET" && url.pathname.startsWith("/protected/")) {
        const scenarioId = url.searchParams.get("scenarioId");
        const fixture = scenarioId ? targetFixtures.get(scenarioId) : undefined;
        const featureId = decodeURIComponent(url.pathname.slice("/protected/".length));
        if (!fixture || !fixture.snapshot) return send(response, 409, { error: "No access state has been established" });
        const allowed = fixture.featureIds.includes(featureId);
        return allowed
          ? send(response, 200, { ok: true, featureId, operation: `${featureId}.protected-operation-completed` })
          : send(response, 403, { ok: false, featureId, reason: "feature is not granted" });
      }
      if (request.method === "GET" && url.pathname === "/test/effects") {
        const scenarioId = keyFrom(request);
        const fixture = scenarioId ? targetFixtures.get(scenarioId) : undefined;
        return fixture ? send(response, 200, { creditGrantCount: fixture.creditGrantCount }) : send(response, 404, { error: "Unknown scenario fixture" });
      }
      return send(response, 404, { error: "Unknown sample target route" });
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : "Sample target error" });
    }
  });
  let targetPort: number;
  try { targetPort = await listen(target, options.targetPort ?? Number(process.env.BILLPROOF_TARGET_PORT ?? 4100)); }
  catch (error) { await new Promise<void>((resolve) => provider.close(() => resolve())); throw error; }
  const targetUrl = `http://127.0.0.1:${targetPort}`;

  return {
    targetUrl,
    providerUrl,
    stop: async () => {
      await Promise.all([new Promise<void>((resolve) => target.close(() => resolve())), new Promise<void>((resolve) => provider.close(() => resolve()))]);
      targetFixtures.clear();
      providerFixtures.clear();
    },
  };
}

if (process.argv[1]?.endsWith("sample-target.ts")) {
  startSampleTarget().then(({ targetUrl, providerUrl }) => {
    console.log(`BillProof sample target listening at ${targetUrl}`);
    console.log(`BillProof simulated provider listening at ${providerUrl}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
