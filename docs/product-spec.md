# BillProof product specification

## Product promise and first customer

**Catch incorrect customer access before release.** BillProof gives a small SaaS team a reproducible report when billing lifecycle state and actual application access diverge. The first buyer is a small SaaS team or agency using a subscription stack such as Stripe, Next.js, and Supabase/Postgres. This is an opportunity hypothesis, not evidence of an uncontested market or validated demand.

The first useful outcome is not a health score. It is one understandable report that names the customer fixture, plan, protected feature, expected result, observed HTTP result, event/delivery sequence, and reproduction command.

## MVP job to be done

When I change, cancel, recover, or retry a subscription event, help me prove whether the application grants exactly the access my business policy intends before I release.

The local MVP offers an explicit project policy, deterministic scenarios, a separately running target, probes against protected feature operations, event/delivery evidence, and a report. It stores all local work across dashboard reloads.

## Policy defaults

| Plan | Features |
| --- | --- |
| Free | Dashboard |
| Pro | Dashboard, exports, API |
| Team | Dashboard, exports, API, collaboration |

Defaults are editable. The policy makes trial access (purchased plan or Free), failed-payment grace duration and access, cancellation behavior, and upgrade/downgrade timing explicit. Plan identifiers are independent from price references. A refund is not implicitly a cancellation.

## Experience

The Overview centers on local real runs and failures. Project setup exposes the mapping/policy. Scenario catalogue lets a user select a target behavior and run one scenario or the suite. Run detail is evidence-first: virtual scenario time and delivery order are separate, each observation compares expected and observed access, and HTTP evidence is redacted. The Integration tab documents the local contract and clearly separates planned Stripe work.

`pass`, `fail`, `error`, and `skipped` have distinct meanings. A malformed response, unreachable target, or timeout is an execution error, never a pass. A root-cause statement is marked **hypothesis** unless the evidence establishes it.

## Deliberate non-goals

No BillProof billing, organizations, accounts, marketplace, outreach, marketing automation, AI agent, real customer data, or production writes. The local target intentionally has unsafe modes solely to demonstrate reports.
