import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppClient } from "../app/ui";
import { demoProject } from "../lib/policy";
import { DEMO_SCENARIOS } from "../lib/scenarios";
import type { ScenarioRun } from "../lib/types";

test("workspace explains first use and distinguishes incomplete reports from passes", () => {
  const state = { version: 1 as const, projects: [demoProject()], scenarios: DEMO_SCENARIOS, runs: [] as ScenarioRun[] };
  const empty = renderToStaticMarkup(createElement(AppClient, { initialState: state }));
  assert.match(empty, /Start the sample target/);
  assert.match(empty, /disabled="">Compare demo targets/);
  const scenario = DEMO_SCENARIOS[0];
  const report: ScenarioRun = {
    id: "ui-test", projectId: state.projects[0].id, scenarioId: scenario.id, scenarioTitle: scenario.title,
    seed: scenario.seed, targetMode: "corrected", status: "error", error: "Target unavailable",
    startedAt: scenario.startAt, completedAt: scenario.startAt, virtualStartAt: scenario.startAt, virtualEndAt: scenario.startAt,
    deliveryAttempts: [], observations: [], findings: [], evidence: [], reproductionCommand: "npm run cli", warnings: ["Cleanup failed"],
  };
  const error = renderToStaticMarkup(createElement(AppClient, { initialState: { ...state, runs: [report] } }));
  assert.match(error, /An incomplete run is not a pass/);
  assert.match(error, /Cleanup warning/);
  assert.match(error, /Find a report/);
  assert.doesNotMatch(error, /All recorded checks matched the rules/);
  const skipped = renderToStaticMarkup(createElement(AppClient, { initialState: { ...state, runs: [{ ...report, status: "skipped", error: undefined }] } }));
  assert.match(skipped, /This check was skipped/);
});
