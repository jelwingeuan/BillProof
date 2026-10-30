import { localUrl } from "../../../lib/local-boundary";
import { BILLPROOF_CONTRACT_VERSION } from "../../../lib/http-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200);
  let checkingProvider = false;

  try {
    const targetUrl = localUrl(process.env.BILLPROOF_TARGET_URL ?? "http://127.0.0.1:4100");
    const providerUrl = localUrl(process.env.BILLPROOF_PROVIDER_URL ?? "http://127.0.0.1:4101");
    const response = await fetch(`${targetUrl}/health`, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.json() as { ok?: unknown; service?: unknown; contractVersion?: unknown; provider?: unknown };
    if (!response.ok || body.ok !== true || typeof body.service !== "string" || !body.service.trim() || body.contractVersion !== BILLPROOF_CONTRACT_VERSION) {
      throw new Error(`The configured service must implement BillProof contract v${BILLPROOF_CONTRACT_VERSION}.`);
    }
    if (body.provider !== providerUrl) {
      throw new Error("The target uses a different provider. Check BILLPROOF_PROVIDER_URL and restart the target.");
    }
    checkingProvider = true;
    const provider = await fetch(`${providerUrl}/provider/state?scenarioId=billproof-doctor`, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (provider.status !== 404) throw new Error(`Provider did not return an isolated 404 for an unknown fixture (received ${provider.status}).`);
    return Response.json({ ready: true, targetUrl, contractVersion: BILLPROOF_CONTRACT_VERSION, latencyMs: Date.now() - started });
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? `${checkingProvider ? "Provider" : "Target"} readiness check timed out.`
      : checkingProvider && error instanceof TypeError ? "Could not reach the local provider. Check BILLPROOF_PROVIDER_URL and start it."
        : error instanceof Error ? error.message : "Target readiness check failed.";
    return Response.json({ ready: false, latencyMs: Date.now() - started, detail }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
