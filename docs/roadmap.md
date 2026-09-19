# Roadmap

## Now: local MVP

Local provider emulator, protected-operation probes, persisted projects/rules/runs, deterministic scenario JSON, CLI, and an evidence-first dashboard. This exists without external credentials.

## Next: staged adapters

Build a reviewed Stripe sandbox adapter with account/project association, isolated customer fixtures, API-version pinning, raw-body signature validation, official test clocks, safe secret storage, and bounded cleanup. Add a Supabase/Postgres staging adapter that can reset a narrowly scoped fixture and observe the application's real protected operations.

## Later: team readiness

Add a durable database, authenticated project boundaries, CI reporting, target-owned credentials, audit retention, configurable convergence polling, and policy/version review. Do not add BillProof billing, organization administration, or a marketplace until a customer need establishes it.
