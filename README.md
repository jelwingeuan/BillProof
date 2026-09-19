# BillProof local MVP

BillProof checks whether a subscription application's **actual protected operations** match explicit access rules. This MVP is a local, deterministic demonstration. It uses simulated billing events and sample data; it does not connect to Stripe, Supabase, or a customer system.

## Quick start

Requires Node 20.9+ (Node 24 was used during local verification).

```bash
git clone https://github.com/jelwingeuan/BillProof.git
cd BillProof
npm install
npm run target
```

In a second terminal:

```bash
cd BillProof
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Select **Stale pre-cancellation event**, choose **Naive demo target**, and run it to see the captured failure. Change to **Reconciled demo target** and rerun the same deterministic seed to see it pass.

The target binds only to `127.0.0.1:4100`; its simulated provider interface binds only to `127.0.0.1:4101`. The dashboard never accepts an arbitrary remote URL.

## Commands

```bash
npm run target                 # separately running sample SaaS + provider emulator
npm run dev                    # local BillProof UI, normally port 3000
npm run cli -- --scenario stale-pre-cancellation --mode corrected
npm test
npm run lint
npm run typecheck
npm run build
```

The CLI exits `0` for a passing run, `1` for findings, and `2` for execution errors. Use `--help` for its small local contract.

## Demo walkthrough

1. Start the target and dashboard.
2. Click **Try demo** or select `stale-pre-cancellation`.
3. Run the naive target. A newer cancellation is followed by an old active snapshot with the same event timestamp; the naive handler restores Pro access. The report records the protected `/protected/exports` response that proves it.
4. Select corrected mode. The target obtains the latest provider state over its own local HTTP interface, so the same stale delivery cannot restore access.
5. Run **Duplicate payment delivery** in corrected mode. Its effect count is exactly one, even though the identical event ID is delivered twice.

Completed runs, the demo project, plans, rules, and report evidence persist in `data/billproof.json`. This is intentionally local JSON persistence rather than SQLite: it keeps setup dependency-free beyond Node packages and uses an atomic rename on write. It is appropriate only for this single-user demo, not concurrent production use.

## What is implemented

- Editable plan/feature mapping and policy defaults: Free, Pro, Team; trials, grace timing, cancellation, upgrade, and downgrade timing.
- Twelve deterministic lifecycle scenarios, a virtual UTC clock, tied event timestamps, retries, delayed/stale delivery, and duplicate IDs.
- A local HTTP adapter that resets a namespaced fixture, updates/queries provider state, delivers events, advances the target clock, probes protected endpoints, and captures redacted HTTP evidence.
- Live local-target readiness, naive-versus-corrected comparison, searchable scenarios, suite progress/cancellation, JSON scenario import validation, report download, persistence, and a copyable CLI reproduction command.

## Important limits

- The billing provider and target are simulations. This does **not** validate a live Stripe integration or prove every possible billing behavior.
- A bounded convergence window is 2 seconds per local HTTP operation. The demo has no asynchronous queue; real targets need an explicit grace/convergence policy per test.
- Refunds remain policy-sensitive and do not automatically cancel a subscription. Seats, metered/usage billing, tax, proration accounting, disputes, and multiple concurrent subscriptions are out of scope.
- The sample target deliberately contains an unsafe mode. It is only seeded demo code, never a patch or diagnosis of a customer application.

## Troubleshooting

- **Target unreachable:** make sure `npm run target` remains open, then reload the dashboard.
- **Port already in use:** stop the process using 4100/4101 or set `BILLPROOF_TARGET_PORT` and `BILLPROOF_PROVIDER_PORT` when starting the target, then set matching values in `.env.local` before starting the dashboard.
- **Run shows error:** error is intentional for an unreachable target, timeout, malformed response, or invalid imported scenario; errors are never converted to passes.
- **Reset the demo data:** stop the dashboard and delete only `BillProof/data/billproof.json`. This removes local BillProof runs and settings.

Read [the product specification](docs/product-spec.md), [architecture and integration contract](docs/architecture.md), [scenario matrix](docs/scenario-matrix.md), [roadmap](docs/roadmap.md), and [pilot validation plan](docs/validation-plan.md) before extending the MVP.
