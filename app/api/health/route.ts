const targetUrl = process.env.BILLPROOF_TARGET_URL ?? "http://127.0.0.1:4100";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200);

  try {
    const response = await fetch(`${targetUrl}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json() as { ok?: unknown; service?: unknown };
    if (!response.ok || body.ok !== true || body.service !== "billproof-sample-target") {
      throw new Error("The configured service did not identify itself as the BillProof sample target.");
    }
    return Response.json({ ready: true, targetUrl, latencyMs: Date.now() - started });
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? "Target readiness check timed out."
      : error instanceof Error ? error.message : "Target readiness check failed.";
    return Response.json({ ready: false, targetUrl, latencyMs: Date.now() - started, detail }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
