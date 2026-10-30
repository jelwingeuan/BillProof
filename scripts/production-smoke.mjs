import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const children = [];
let temporaryDirectory;
let cleanupPromise;

function start(name, args, environment) {
  const child = spawn(globalThis.process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: root,
    env: { ...globalThis.process.env, ...environment },
    detached: globalThis.process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const process = { name, child, output: "", error: undefined };
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { process.output = `${process.output}${chunk}`.slice(-8_000); });
  }
  child.on("error", (error) => { process.error = error; });
  children.push(process);
  return process;
}

function ensureRunning(process) {
  if (process.error) throw process.error;
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    throw new Error(`${process.name} exited before the smoke check finished (code ${process.child.exitCode ?? process.child.signalCode}).`);
  }
}

async function waitFor(label, timeoutMs, check, processes) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const process of processes) ensureRunning(process);
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms.`);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function terminate(process) {
  const { child } = process;
  if (!child.pid) return;
  try {
    if (globalThis.process.platform === "win32") child.kill("SIGTERM");
    else globalThis.process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2_000),
    ]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (globalThis.process.platform === "win32") child.kill("SIGKILL");
      else globalThis.process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

function cleanup() {
  cleanupPromise ??= (async () => {
    await Promise.allSettled(children.map(terminate));
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  })();
  return cleanupPromise;
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  globalThis.process.once(signal, () => { void cleanup().finally(() => globalThis.process.exit(code)); });
}

try {
  await access(join(root, ".next", "BUILD_ID"));
  temporaryDirectory = await mkdtemp(join(tmpdir(), "billproof-smoke-"));
  const dataPath = join(temporaryDirectory, "billproof.json");

  const target = start("sample target", ["run", "target"], {
    BILLPROOF_TARGET_PORT: "0",
    BILLPROOF_PROVIDER_PORT: "0",
  });
  const urls = await waitFor("sample target URLs", 20_000, () => {
    const targetUrl = target.output.match(/BillProof sample target listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    const providerUrl = target.output.match(/BillProof simulated provider listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    return targetUrl && providerUrl ? { targetUrl, providerUrl } : undefined;
  }, [target]);

  const dashboardPort = await availablePort();
  const dashboard = start("production dashboard", ["start", "--", "-p", String(dashboardPort)], {
    BILLPROOF_TARGET_URL: urls.targetUrl,
    BILLPROOF_PROVIDER_URL: urls.providerUrl,
    BILLPROOF_DATA_PATH: dataPath,
  });
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  await waitFor("production dashboard readiness", 30_000, async () => {
    try {
      const response = await fetch(`${dashboardUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      return response.status === 200 && (await response.json()).ready === true;
    } catch {
      return false;
    }
  }, [target, dashboard]);

  const response = await fetch(`${dashboardUrl}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: dashboardUrl },
    body: JSON.stringify({ scenarioId: "stale-pre-cancellation", mode: "corrected" }),
    signal: AbortSignal.timeout(70_000),
  });
  assert.equal(response.status, 200, `POST /api/run returned ${response.status}`);
  const run = await response.json();
  assert.equal(run.scenarioId, "stale-pre-cancellation");
  assert.equal(run.targetMode, "corrected");
  assert.equal(run.status, "pass", `Corrected scenario status was ${run.status}: ${run.error ?? "no error detail"}`);
  assert.ok(run.evidence?.some((item) => item.label === "Query authoritative provider state" && item.method === "GET" && item.responseStatus === 200), "Run lacks successful provider GET evidence.");
  console.log("PASS production smoke: dashboard ready, corrected scenario passed, provider GET evidence captured.");
} catch (error) {
  console.error(`FAIL production smoke: ${error instanceof Error ? error.message : String(error)}`);
  for (const process of children) {
    if (process.output) console.error(`${process.name} output:\n${process.output.slice(-2_000)}`);
  }
  globalThis.process.exitCode = 1;
} finally {
  await cleanup();
}
