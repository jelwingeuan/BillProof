# BillProof integration contract v1

BillProof currently verifies a loopback-only target. The bundled sample target is the reference implementation. All responses are JSON, redirects are rejected, and request/response bodies are limited to 100 KB.

Set `BILLPROOF_TARGET_URL` and `BILLPROOF_PROVIDER_URL` to HTTP loopback origins without paths, credentials, queries, or fragments. The defaults are `http://127.0.0.1:4100` and `http://127.0.0.1:4101`.

## Target endpoints

| Method | Path | Purpose | Successful response |
| --- | --- | --- | --- |
| `GET` | `/health` | Identify the target and contract | `200 { "ok": true, "service": "billproof-sample-target", "contractVersion": 1, "provider": "..." }` |
| `POST` | `/test/reset` | Create an isolated fixture | `200` |
| `DELETE` | `/test/fixture?scenarioId=...` | Release a fixture | `2xx` |
| `POST` | `/test/clock` | Set the fixture's virtual UTC time | `200` |
| `POST` | `/webhooks` | Deliver one simulated billing event | `2xx` when accepted; non-`2xx` when rejected |
| `GET` | `/protected/{feature}` | Exercise real protected behavior | `200 { "ok": true }` or `403 { "ok": false }` |
| `GET` | `/test/effects?scenarioId=...` | Read the demo credit effect | `200 { "creditGrantCount": 0 }` |

Fixture-mutating requests include a `scenarioId`. Reset also receives `customerId`, `mode`, and the validated project. Clock requests receive an ISO UTC `at`. Webhook requests receive `{ scenarioId, event, retry }`.

## Provider endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/provider/reset` | Clear one fixture |
| `POST` | `/provider/state` | Set its authoritative subscription snapshot |
| `GET` | `/provider/state?scenarioId=...` | Read that snapshot; unknown fixtures return `404` |
| `DELETE` | `/provider/state?scenarioId=...` | Release the fixture |

The exact payload schemas live in [`lib/types.ts`](../lib/types.ts). Run `npm run target` and then `npm run doctor` before using a custom scenario. A future breaking endpoint or payload change must increment `contractVersion`.
