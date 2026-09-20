import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import test from "node:test";
import { AdapterError, LocalHttpAdapter } from "../lib/http-adapter";
import { ScenarioSchema } from "../lib/types";

async function server(handler: RequestListener): Promise<{ url: string; stop: () => Promise<void> }> {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return { url: `http://127.0.0.1:${address.port}`, stop: () => new Promise((resolve) => instance.close(() => resolve())) };
}

test("invalid scenario input is rejected by runtime validation", () => {
  assert.equal(ScenarioSchema.safeParse({ id: "not enough" }).success, false);
});

test("malformed evidence and timeout are execution errors, never passes", async () => {
  const malformed = await server((_request, response) => { response.writeHead(200, { "content-type": "text/plain" }); response.end("not-json"); });
  const adapter = new LocalHttpAdapter({ targetUrl: malformed.url, providerUrl: malformed.url, timeoutMs: 80 });
  await assert.rejects(() => adapter.probe("fixture", "api"), AdapterError);
  await malformed.stop();

  const slow = await server((_request, response) => { setTimeout(() => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"ok":true}'); }, 120); });
  const timeoutAdapter = new LocalHttpAdapter({ targetUrl: slow.url, providerUrl: slow.url, timeoutMs: 20 });
  await assert.rejects(() => timeoutAdapter.probe("fixture", "api"), AdapterError);
  await slow.stop();
});

test("contradictory status bodies, oversized responses and redirects are rejected", async () => {
  let requestedPath = "";
  const configured = await server((request, response) => { requestedPath = request.url!; response.writeHead(200); response.end('{"ok":true}'); });
  try {
    await new LocalHttpAdapter({ targetUrl: configured.url, timeoutMs: 100 }).probe("fixture", "api", "/custom-api");
    assert.equal(requestedPath, "/custom-api?scenarioId=fixture");
  } finally { await configured.stop(); }
  const contradictory = await server((_request, response) => { response.writeHead(403); response.end('{"ok":true}'); });
  try { await assert.rejects(new LocalHttpAdapter({ targetUrl: contradictory.url, timeoutMs: 100 }).probe("fixture", "api"), /contradicts/); }
  finally { await contradictory.stop(); }
  const oversized = await server((_request, response) => { response.writeHead(200); response.end(JSON.stringify({ ok: true, padding: "x".repeat(100_001) })); });
  try { await assert.rejects(new LocalHttpAdapter({ targetUrl: oversized.url, timeoutMs: 100 }).probe("fixture", "api"), /exceeds 100 KB/); }
  finally { await oversized.stop(); }
  const redirect = await server((_request, response) => { response.writeHead(302, { location: "http://example.com" }); response.end(); });
  try { await assert.rejects(new LocalHttpAdapter({ targetUrl: redirect.url, timeoutMs: 100 }).probe("fixture", "api"), AdapterError); }
  finally { await redirect.stop(); }
});

test("cleanup still runs after the scenario deadline", async () => {
  const requests: string[] = [];
  const target = await server((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  try {
    const adapter = new LocalHttpAdapter({ targetUrl: target.url, providerUrl: target.url, timeoutMs: 100, runDeadlineMs: 0 });
    await assert.rejects(adapter.probe("expired", "api"), /60-second execution deadline/);
    await adapter.cleanup("expired");
    assert.deepEqual(requests.sort(), ["DELETE /provider/state?scenarioId=expired", "DELETE /test/fixture?scenarioId=expired"]);
  } finally { await target.stop(); }
});
