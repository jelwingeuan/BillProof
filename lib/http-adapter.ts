import { BillingEventSchema, ProjectSchema, SubscriptionSnapshotSchema, type BillingEvent, type HttpEvidence, type Project, type SubscriptionSnapshot, type TargetMode } from "./types";
import { localUrl } from "./local-boundary";

export class AdapterError extends Error {
  constructor(message: string, readonly evidence?: HttpEvidence) {
    super(message);
    this.name = "AdapterError";
  }
}

type HttpResult = { status: number; body: unknown; evidence: HttpEvidence };

export const BILLPROOF_CONTRACT_VERSION = 1;

function redact(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/(?:sk|pk|whsec)_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .slice(0, 1_200);
}

export class LocalHttpAdapter {
  readonly targetUrl: string;
  readonly providerUrl: string;
  readonly timeoutMs: number;
  readonly deadline: number;

  constructor(options: { targetUrl?: string; providerUrl?: string; timeoutMs: number; runDeadlineMs?: number }) {
    this.targetUrl = localUrl(options.targetUrl ?? process.env.BILLPROOF_TARGET_URL ?? "http://127.0.0.1:4100");
    this.providerUrl = localUrl(options.providerUrl ?? process.env.BILLPROOF_PROVIDER_URL ?? "http://127.0.0.1:4101");
    this.timeoutMs = options.timeoutMs;
    this.deadline = Date.now() + (options.runDeadlineMs ?? 60_000);
  }

  private async request(label: string, method: string, base: string, path: string, payload?: unknown, ignoreRunDeadline = false, observationDeadline = Infinity): Promise<HttpResult> {
    const started = Date.now();
    const controller = new AbortController();
    const remaining = ignoreRunDeadline ? Math.min(this.timeoutMs, 2_000) : Math.min(this.timeoutMs, this.deadline - started, observationDeadline - started);
    if (observationDeadline <= started) throw new AdapterError("Access convergence deadline exceeded.");
    if (remaining <= 0) throw new AdapterError("Scenario exceeded the 60-second execution deadline.");
    const timer = setTimeout(() => controller.abort(), remaining);
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, {
        method,
        redirect: "error",
        headers: payload === undefined ? undefined : { "content-type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 100_000) { await reader.cancel(); throw new AdapterError("Target response exceeds 100 KB."); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        const evidence = { label, method, url, requestSummary: redact(payload ?? ""), responseStatus: response.status, responseBody: redact(raw), elapsedMs: Date.now() - started };
        throw new AdapterError("Target returned malformed JSON evidence.", evidence);
      }
      if (Date.now() >= observationDeadline) throw new AdapterError("Access convergence deadline exceeded.");
      return {
        status: response.status,
        body,
        evidence: { label, method, url, requestSummary: redact(payload ?? ""), responseStatus: response.status, responseBody: redact(body), elapsedMs: Date.now() - started },
      };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      const message = error instanceof Error && error.name === "AbortError" ? `Timed out after ${remaining}ms.` : `Could not reach local target: ${error instanceof Error ? error.message : "unknown error"}`;
      throw new AdapterError(message, { label, method, url, requestSummary: redact(payload ?? ""), responseStatus: null, responseBody: message, elapsedMs: Date.now() - started });
    } finally {
      clearTimeout(timer);
    }
  }

  async reset(scenarioId: string, customerId: string, mode: TargetMode, project: Project): Promise<HttpEvidence[]> {
    const parsedProject = ProjectSchema.parse(project);
    const provider = await this.request("Reset simulated provider fixture", "POST", this.providerUrl, "/provider/reset", { scenarioId, customerId });
    const target = await this.request("Reset sample target fixture", "POST", this.targetUrl, "/test/reset", { scenarioId, customerId, mode, project: parsedProject });
    if (provider.status >= 300 || target.status >= 300) throw new AdapterError("Fixture reset was rejected.", target.evidence);
    return [provider.evidence, target.evidence];
  }

  async cleanup(scenarioId: string): Promise<void> {
    const results = await Promise.all([
      this.request("Release target fixture", "DELETE", this.targetUrl, `/test/fixture?scenarioId=${encodeURIComponent(scenarioId)}`, undefined, true),
      this.request("Release provider fixture", "DELETE", this.providerUrl, `/provider/state?scenarioId=${encodeURIComponent(scenarioId)}`, undefined, true),
    ]);
    const rejected = results.find((result) => result.status >= 300);
    if (rejected) throw new AdapterError("Fixture cleanup was rejected.", rejected.evidence);
  }

  async setProviderState(scenarioId: string, state: SubscriptionSnapshot): Promise<HttpEvidence> {
    const result = await this.request("Set authoritative provider state", "POST", this.providerUrl, "/provider/state", { scenarioId, state: SubscriptionSnapshotSchema.parse(state) });
    if (result.status >= 300) throw new AdapterError("Provider emulator rejected the subscription snapshot.", result.evidence);
    return result.evidence;
  }

  async getProviderState(scenarioId: string): Promise<{ state: SubscriptionSnapshot; evidence: HttpEvidence }> {
    const result = await this.request("Query authoritative provider state", "GET", this.providerUrl, `/provider/state?scenarioId=${encodeURIComponent(scenarioId)}`);
    if (result.status >= 300 || typeof result.body !== "object" || result.body === null || !("state" in result.body)) throw new AdapterError("Provider state is unavailable.", result.evidence);
    return { state: SubscriptionSnapshotSchema.parse((result.body as { state: unknown }).state), evidence: result.evidence };
  }

  async advanceClock(scenarioId: string, at: string): Promise<HttpEvidence> {
    const result = await this.request("Advance target virtual clock", "POST", this.targetUrl, "/test/clock", { scenarioId, at });
    if (result.status >= 300) throw new AdapterError("Target rejected virtual clock advance.", result.evidence);
    return result.evidence;
  }

  async deliver(scenarioId: string, item: BillingEvent, retry: boolean): Promise<HttpResult> {
    return this.request("Deliver simulated billing event", "POST", this.targetUrl, "/webhooks", { scenarioId, event: BillingEventSchema.parse(item), retry });
  }

  async probe(scenarioId: string, featureId: string, protectedPath = `/protected/${encodeURIComponent(featureId)}`, observationDeadline = Infinity): Promise<{ allowed: boolean; evidence: HttpEvidence }> {
    const result = await this.request(`Probe protected ${featureId} operation`, "GET", this.targetUrl, `${protectedPath}?scenarioId=${encodeURIComponent(scenarioId)}`, undefined, false, observationDeadline);
    if ((result.status !== 200 && result.status !== 403) || typeof result.body !== "object" || result.body === null || typeof (result.body as { ok?: unknown }).ok !== "boolean") {
      throw new AdapterError("Target returned malformed protected-operation evidence.", result.evidence);
    }
    if ((result.body as { ok: boolean }).ok !== (result.status === 200)) throw new AdapterError("Protected-operation status contradicts its response body.", result.evidence);
    return { allowed: result.status === 200, evidence: result.evidence };
  }

  async effectCount(scenarioId: string): Promise<{ count: number; evidence: HttpEvidence }> {
    const result = await this.request("Read protected side-effect count", "GET", this.targetUrl, `/test/effects?scenarioId=${encodeURIComponent(scenarioId)}`);
    const count = typeof result.body === "object" && result.body !== null ? (result.body as { creditGrantCount?: unknown }).creditGrantCount : undefined;
    if (result.status >= 300 || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new AdapterError("Target returned malformed side-effect evidence.", result.evidence);
    return { count, evidence: result.evidence };
  }
}
