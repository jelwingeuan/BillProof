import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BILLPROOF_CONTRACT_VERSION } from "../lib/http-adapter";
import { localUrl } from "../lib/local-boundary";
import { readState } from "../lib/store";

const checks: string[] = [];

async function check(name: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
    checks.push(`PASS  ${name}`);
  } catch (error) {
    checks.push(`FAIL  ${name}: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
await check("Node.js >= 20.9", async () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) throw new Error(`found ${process.versions.node}`);
});

await check("local data is valid and writable", async () => {
  await readState();
  const dataPath = process.env.BILLPROOF_DATA_PATH ?? join(process.cwd(), "data", "billproof.json");
  await mkdir(dirname(dataPath), { recursive: true });
  const probe = `${dataPath}.${randomUUID()}.doctor`;
  const file = await open(probe, "wx", 0o600);
  await file.close();
  await unlink(probe);
});

const targetUrl = localUrl(process.env.BILLPROOF_TARGET_URL ?? "http://127.0.0.1:4100");
const providerUrl = localUrl(process.env.BILLPROOF_PROVIDER_URL ?? "http://127.0.0.1:4101");

await check(`target implements contract v${BILLPROOF_CONTRACT_VERSION}`, async () => {
  const response = await fetch(`${targetUrl}/health`, { redirect: "error", signal: AbortSignal.timeout(1_200) });
  const body = await response.json() as { ok?: unknown; service?: unknown; contractVersion?: unknown; provider?: unknown };
  if (!response.ok || body.ok !== true || body.service !== "billproof-sample-target" || body.contractVersion !== BILLPROOF_CONTRACT_VERSION) {
    throw new Error("unexpected health response");
  }
  if (body.provider !== providerUrl) throw new Error(`target uses ${String(body.provider)} instead of ${providerUrl}`);
});

await check("provider emulator is reachable", async () => {
  const response = await fetch(`${providerUrl}/provider/state?scenarioId=billproof-doctor`, { redirect: "error", signal: AbortSignal.timeout(1_200) });
  if (response.status !== 404) throw new Error(`expected isolated 404, received ${response.status}`);
});

console.log(checks.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Doctor failed");
  process.exitCode = 1;
});
