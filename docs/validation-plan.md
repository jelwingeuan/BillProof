# Pilot validation plan

The following are hypotheses, not validated pricing, demand, customer commitments, or outreach instructions. Do not contact people from this document automatically.

## Discovery interviews

Conduct 10 founder/agency interviews with people who ship subscription SaaS applications. Ask:

1. Tell me about the last billing/access incident you caught late or missed.
2. Which access-changing events feel least safe to release, and why?
3. How do you currently test cancellation, recovery, retries, and plan changes?
4. Would a protected-operation report change a release decision? What evidence would it need?
5. Who owns subscription access correctness, and what workflow would fit their release process?
6. What target integration would be necessary before a trial is useful?
7. What would make a local/staging testing tool unsafe or unacceptable?
8. If a pilot were useful, would US$100–300 per app be plausible? Why or why not?

## Measurable criteria

Advance only if at least 6/10 describe a recent, concrete mismatch risk; at least 4/10 request a reproducible staging check; and at least 3 agree to a scoped pilot conversation. Run at most 3 paid pilots in the US$100–300-per-app hypothesis range only with explicit agreement. For each pilot, measure time to first configured test, number of actionable reports, reproduction success, and whether it changed a release decision. A price mention alone is not validation.

## Falsification signals

Stop or narrow the direction if teams already trust a cheaper workflow, cannot grant safe staging access, do not value protected-operation evidence, or report that policy setup cost exceeds the risk reduced.
