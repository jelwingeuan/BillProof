# Architecture and integration contract

## Decision record

The MVP is one straightforward Next.js App Router dashboard plus a separately launched Node HTTP sample target. The target hosts a local provider emulator on a different loopback port. It never imports the checker policy evaluator: the checker calculates expected access independently, while the target has its own deliberately simple entitlement logic. This duplication is intentional test isolation, not a production recommendation.

Persistence is a validated JSON document with a cross-process filesystem lock, flushed private temporary files, and atomic replacement. Bulk imports commit together, stale policy edits are rejected, and corruption is surfaced without resetting data. The scope is one operator on a local disk; there is no query engine, encryption, multi-host coordination, or built-in backup service. See README.md for backup and crash-lock recovery.

## Local topology

```text
Browser → Next dashboard/API :3000 → runner → sample target :4100 → provider emulator :4101
                                      │             │
                                      └── probe protected feature endpoints ──┘
```

All three listener URLs are fixed loopback defaults. The dashboard does not fetch a user-supplied network address, avoiding a hosted-service SSRF and authorization design that is out of scope.

## Adapter contract

The `LocalHttpAdapter` implements this small test-target contract. A real adapter may implement the same operations with authenticated, isolated staging fixtures.

| Operation | Local endpoint | Purpose |
| --- | --- | --- |
| Reset fixture | `POST /test/reset` | Clears one scenario namespace and selects naive/corrected mode. |
| Set provider state | `POST :4101/provider/state` | Sets authoritative subscription state independently of deliveries. |
| Query provider state | `GET :4101/provider/state?scenarioId=` | Records what reconciliation considers authoritative. |
| Deliver event | `POST :4100/webhooks` | Sends a simulated event snapshot, delivery id, and retry context. |
| Advance clock | `POST :4100/test/clock` | Sets deterministic UTC scenario time; corrected mode re-reconciles. |
| Probe access | `GET :4100/protected/:feature` | Performs a protected operation instead of trusting an entitlement claim. |
| Read effect count | `GET :4100/test/effects` | Detects duplicate credits/audit effects even when access is unchanged. |

Every operation defaults to a two-second timeout within a 60-second run deadline, validates JSON, and retains only small redacted response bodies. A new UUID fixture namespace isolates every run, including simultaneous runs of the same scenario. Cleanup deletes both target and provider fixtures. The adapter rejects contradictory status/body results, redirects, non-loopback origins, and responses over 100 KB. A denied protected operation must return HTTP 403 with `ok: false`.

Reports retain an immutable copy of project and scenario inputs. CLI `--report` uses these inputs; `--scenario` uses current saved state. Imported assertions are evaluated, and a run without access/effect checks cannot pass. All dashboard data is protected by local Host/Origin checks; the sample services enforce the same boundary. `npm start` binds to loopback and is not a public deployment command.

## Event and consistency model

Scenario state has three independent axes: virtual UTC time, authoritative provider snapshot, and delivery attempts. A snapshot can be newer than a delivery or be delivered twice. The corrected target reconciles current provider state over HTTP and records processed event IDs before applying credit side effects. The naive target directly applies event snapshots and increments credits on every receipt; it intentionally fails stale-event and idempotency checks.

This follows Stripe's webhook guidance: event delivery is not guaranteed in generation order, distinct events can share the second-level `created` timestamp, and event IDs must be tracked for duplicates. Event time or ID sorting is not presented as a causal-ordering solution. See [Stripe's event delivery behavior](https://docs.stripe.com/webhooks#event-ordering) and [duplicate guidance](https://docs.stripe.com/webhooks#handle-duplicate-events).

## Future Stripe sandbox milestone (not implemented)

1. Associate a customer-owned staging project and only an isolated sandbox/customer fixture.
2. Use Stripe test clocks/simulations in a dedicated sandbox; Stripe documents clock-controlled Billing lifecycle simulations, including trials and plan changes ([test clocks](https://docs.stripe.com/billing/testing/test-clocks)).
3. Pin the event destination/API version, verify webhook signatures from raw request bytes, store secrets server-side, and use the official library. Stripe explicitly requires the unmodified raw body for signature verification ([webhooks](https://docs.stripe.com/webhooks#verify-events-are-sent-from-stripe)).
4. Treat real delivery order as uncontrollable. A test delivery proxy may reorder **our test sends**, but cannot command Stripe's delivery order. Reconcile current provider objects or use a concurrency/version strategy appropriate to the target.
5. Use a Supabase/Postgres adapter for target-specific fixture resets and observed access once account authorization, RLS, audit logging, and scoped credentials are reviewed. Supabase is a roadmap option, not a local prerequisite.

Stripe's entitlements documentation and Hookdeck are relevant comparison points, not claims about feature parity: [Stripe Entitlements](https://docs.stripe.com/billing/entitlements), [Hookdeck](https://hookdeck.com/), and [Supabase docs](https://supabase.com/docs).
