# Contributing to BillProof

BillProof welcomes focused bug fixes, tests, documentation, and lifecycle scenarios.

1. Fork the repository and create a small branch.
2. Use Node 24 and run `npm ci`.
3. Start the sample target with `npm run target`; use `npm run doctor` to verify the local setup.
4. Make the smallest change that solves one problem. Add a test when behavior changes.
5. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
6. Open a pull request describing the behavior, evidence, and any remaining limit.

Do not include real customer data, credentials, production billing events, or generated `data/billproof.json` files. By contributing, you agree that your contribution is licensed under the MIT License.
