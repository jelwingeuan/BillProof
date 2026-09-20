# BillProof local verifier

BillProof checks whether a subscription application's **actual protected operations** match explicit access rules. This MVP is a local, deterministic demonstration. It uses simulated billing events and sample data; it does not connect to Stripe, Supabase, or a customer system.

## Quick start

Node 24 is the supported runtime for this release (`nvm use` if you use nvm).

```bash
git clone https://github.com/jelwingeuan/BillProof.git
cd BillProof
npm ci
npm run target
```

In a second terminal:

```bash
cd BillProof
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and click **Compare demo targets**. The same scenario produces a failure in naive mode and a pass in corrected mode. Open **Scenarios** to run individual checks or the full suite.

All three processes bind to loopback. The dashboard runs on port 3000, the target on 4100, and the provider on 4101. Host/origin checks reject browser requests from other sites. Outbound target URLs must be HTTP loopback origins and redirects are rejected. This is a trusted, single-operator workstation tool; there is no user authentication, public hosting, or tenant isolation.

## Production build for local use

Run `npm ci`, `npm test`, and `npm run build`. Keep `npm run target` running in one terminal and run `npm start` in another. Use `npm run dev` only while developing. Keep the checkout and data on a local disk and use one dashboard process. Stop both processes with Ctrl-C before upgrading or restoring data. The target is simulated in both development and production builds.

## Commands

```bash
npm run target                 # separately running sample SaaS + provider emulator
npm run doctor                 # check runtime, data, target contract, and provider
npm run dev                    # local BillProof UI, normally port 3000
npm run cli -- --scenario stale-pre-cancellation --mode corrected
npm test
npm run lint
npm run typecheck
npm run build
```

The CLI exits `0` for a passing run, `1` for findings, and `2` for execution errors. Use `--help` for its small local contract. Run `npm run doctor` while the target is running to diagnose setup problems before opening the dashboard.

## Demo walkthrough

1. Start the target and dashboard.
2. Click **Compare demo targets** or select `stale-pre-cancellation`.
3. Run the naive target. A newer cancellation is followed by an old active snapshot with the same event timestamp; the naive handler restores Pro access. The report records the protected `/protected/exports` response that proves it.
4. Select corrected mode. The target obtains the latest provider state over its own local HTTP interface, so the same stale delivery cannot restore access.
5. Run **Duplicate payment delivery** in corrected mode. Its effect count is exactly one, even though the identical event ID is delivered twice.

Completed runs, plans, rules, and scenario definitions persist in `data/billproof.json`. Writes validate the full document, acquire a cross-process filesystem lock, flush a private temporary file, and atomically replace the document. Concurrent edits preserve unrelated records; stale policy edits are rejected. A corrupt file is never silently reset. The latest 100 reports are retained; download important reports before they age out.

## Replay and backup

The CLI’s `--scenario` option reads the saved catalogue and policy. Newly downloaded reports contain their original scenario and project inputs; replay one with `npm run cli -- --report "path/to/report.json"`. This reproduces the input and mode even after later policy edits. The target must be running. Legacy reports without captured inputs cannot use `--report`.

Back up `data/billproof.json` to a dated file outside the checkout (or your configured `BILLPROOF_DATA_PATH`). For restore, stop both processes, keep a copy of the current file, copy your backup to the original path, then restart and verify the policy and reports. Backups contain report evidence; protect them like the original file. No backup upload occurs automatically.

If a crash leaves `data/billproof.json.lock`, saves fail safely after five seconds. Stop all BillProof processes first, then remove only that empty directory with `rmdir data/billproof.json.lock` and restart. For a custom data path, use its exact `.lock` directory. Do not remove a lock while a writer may still be active. Atomic replacement protects against partial application writes; independent backups remain necessary for disk failure.

## What is implemented

- Editable plan/feature mapping, trial access, access during grace, and default cancellation. Grace expiry and plan-change dates are supplied by scenario snapshots; legacy timing fields remain readable for compatibility and are not advertised as active controls.
- Twelve deterministic lifecycle scenarios, a virtual UTC clock, tied event timestamps, retries, delayed/stale delivery, and duplicate IDs.
- A local HTTP adapter that resets a namespaced fixture, updates/queries provider state, delivers events, advances the target clock, probes protected endpoints, and captures redacted HTTP evidence.
- Live local-target readiness, naive-versus-corrected comparison, searchable scenarios, suite progress/cancellation, JSON scenario import validation, report download, persistence, and a copyable CLI reproduction command.

## Important limits

- The billing provider and target are simulations. This does **not** validate a live Stripe integration or prove every possible billing behavior.
- Operations default to a two-second timeout and runs have a 60-second deadline. Access checks retry inside the configured convergence window before reporting a mismatch. JSON requests and target responses are limited to 100 KB. Imports contain 1–50 unique scenarios (up to 100 steps each), with at most 200 saved scenarios.
- Explicit access assertions compare the final observation of that feature; effect assertions check the final effect count. Runs without checks or with unrecovered failed deliveries return an error. Run fixtures are unique and released on completion.
- A probe that does not complete within the convergence window returns an execution error; a completed mismatch remains a finding. Cleanup failures are retained as report warnings and shown in the dashboard and CLI.
- Refunds remain policy-sensitive and do not automatically cancel a subscription. Seats, metered/usage billing, tax, proration accounting, disputes, and multiple concurrent subscriptions are out of scope.
- The sample target deliberately contains an unsafe mode. It is only seeded demo code, never a patch or diagnosis of a customer application.

## Troubleshooting

- **Target unreachable:** make sure `npm run target` remains open, then reload the dashboard.
- **Port already in use:** stop the process using 4100/4101 or set `BILLPROOF_TARGET_PORT` and `BILLPROOF_PROVIDER_PORT` when starting the target, then set matching values in `.env.local` before starting the dashboard.
- **Run shows error:** error is intentional for an unreachable target, timeout, malformed response, or invalid imported scenario; errors are never converted to passes.
- **Reset the demo data:** stop the dashboard and delete only `BillProof/data/billproof.json`. This removes local BillProof runs and settings.

Read [the product specification](docs/product-spec.md), [architecture](docs/architecture.md), [integration contract v1](docs/integration-contract.md), [scenario matrix](docs/scenario-matrix.md), [roadmap](docs/roadmap.md), and [pilot validation plan](docs/validation-plan.md) before extending the MVP. Contributions are welcome under the [MIT License](LICENSE); see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
