# Changelog

Notable changes to BillProof are recorded here.

## Unreleased — 0.2.0

- Applied Excon across the workbench, reports, controls, evidence, and IDs, with Geist Sans as the offline fallback.
- Preserved workspace sections in shareable URLs and browser history, and reduced duplicate suite announcements.
- Gave the local workbench a dark verification layout with direct run actions and evidence-focused reports.
- Added a production smoke check for the built dashboard and sample target.
- Verified provider readback before access checks and retained stale or malformed responses as error evidence.
- Accepted custom local target service names while retaining contract and provider checks.
- Checked provider reachability and fixture isolation before enabling dashboard runs.
- Matched mobile scenario keyboard order to the visible layout and made the selected run controls easy to reach.
- Switched the interface to Author with an offline Geist fallback; contract v2 requires protected responses to name the probed feature.
- Added bounded access-convergence polling and reliable post-timeout fixture cleanup.
- Preserved cleanup warnings in reports, dashboard, and CLI; rejected protected responses arriving after the convergence deadline.
- Standardized the supported runtime on Node 24 and added `.nvmrc`.
- Added versioned run and target contracts plus `npm run doctor`.
- Added open-source license, contribution, security, and community files.
- Hardened local persistence, imports, replay, evidence, and dashboard usability.
