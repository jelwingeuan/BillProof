import { localUrl } from "../../../lib/local-boundary";
import { BILLPROOF_CONTRACT_VERSION } from "../../../lib/http-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200);

  try {
    const targetUrl = localUrl(process.env.BILLPROOF_TARGET_URL ?? "http://127.0.0.1:4100");
    const response = await fetch(`${targetUrl}/health`, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.json() as { ok?: unknown; service?: unknown; contractVersion?: unknown };
    if (!response.ok || body.ok !== true || body.service !== "billproof-sample-target" || body.contractVersion !== BILLPROOF_CONTRACT_VERSION) {
      throw new Error(`The configured service must implement BillProof contract v${BILLPROOF_CONTRACT_VERSION}.`);
    }
    return Response.json({ ready: true, targetUrl, contractVersion: BILLPROOF_CONTRACT_VERSION, latencyMs: Date.now() - started });
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? "Target readiness check timed out."
      : error instanceof Error ? error.message : "Target readiness check failed.";
    return Response.json({ ready: false, latencyMs: Date.now() - started, detail }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
