import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppClient, SuiteProgress } from "../app/ui";
import { demoProject } from "../lib/policy";
import { DEMO_SCENARIOS } from "../lib/scenarios";
import type { ScenarioRun } from "../lib/types";

test("workspace explains first use and distinguishes incomplete reports from passes", () => {
  const state = { version: 1 as const, projects: [demoProject()], scenarios: DEMO_SCENARIOS, runs: [] as ScenarioRun[] };
  const empty = renderToStaticMarkup(createElement(AppClient, { initialState: state }));
  assert.match(empty, /Checking sample target before checks can run/);
  assert.match(empty, /disabled="">Compare demo targets/);
  const connection = renderToStaticMarkup(createElement(AppClient, { initialState: state, initialTab: "connection" }));
  assert.match(connection, /<h1[^>]*>Local connection<\/h1>/);
  assert.match(connection, /aria-current="page">Connection<\/button>/);
  const invalid = renderToStaticMarkup(createElement(AppClient, { initialState: state, initialTab: "unknown" }));
  assert.match(invalid, /<h1[^>]*>Verify subscription access\.<\/h1>/);
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
  assert.match(error, /<strong class="metric-amber">error<\/strong>/);
  assert.doesNotMatch(error, /<strong class="metric-green">0<\/strong>/);
  assert.doesNotMatch(error, /All recorded checks matched the rules/);
  const skipped = renderToStaticMarkup(createElement(AppClient, { initialState: { ...state, runs: [{ ...report, status: "skipped", error: undefined }] } }));
  assert.match(skipped, /This check was skipped/);
  assert.match(skipped, /Latest result<\/span><strong>skipped<\/strong>/);
  assert.doesNotMatch(skipped, /<strong class="metric-green">0<\/strong>/);

  const withInputs = renderToStaticMarkup(createElement(AppClient, { initialState: { ...state, runs: [{ ...report, inputs: { project: state.projects[0], scenario } }] } }));
  assert.match(withInputs, new RegExp(`customer fixture <code>${scenario.customerId}</code>`));
  assert.match(error, /customer fixture <code>unavailable in legacy report<\/code>/);
});

test("report bookmarks restore the exact saved run and explain missing IDs", () => {
  const project = demoProject();
  const scenario = DEMO_SCENARIOS[0];
  const base: ScenarioRun = {
    id: "newer", projectId: project.id, scenarioId: scenario.id, scenarioTitle: "Newer report",
    seed: scenario.seed, targetMode: "corrected", status: "pass",
    startedAt: scenario.startAt, completedAt: scenario.startAt, virtualStartAt: scenario.startAt, virtualEndAt: scenario.startAt,
    deliveryAttempts: [], observations: [], findings: [], evidence: [], reproductionCommand: "npm run cli",
  };
  const state = { version: 1 as const, projects: [project], scenarios: [scenario], runs: [base, { ...base, id: "older", scenarioTitle: "Older report" }] };
  const bookmarked = renderToStaticMarkup(createElement(AppClient, { initialState: state, initialRunId: "older" }));
  assert.match(bookmarked, /Selected report<\/p><div class="report-title"><h2>Older report<\/h2>/);
  assert.match(bookmarked, /href="\/\?run=older#run-report"/);
  const unavailable = renderToStaticMarkup(createElement(AppClient, { initialState: state, initialRunId: "removed" }));
  assert.match(unavailable, /This report is not saved on this device/);
  assert.doesNotMatch(unavailable, /Selected report<\/p>/);
});

test("React Bits suite verdict reflects findings instead of showing a success mark", () => {
  const base = { status: "complete" as const, completed: 2, total: 2, counts: { pass: 2, fail: 0, error: 0, skipped: 0 } };
  const allPass = renderToStaticMarkup(createElement(SuiteProgress, { suite: base, onViewLatest: () => {} }));
  assert.match(allPass, /data-status="done"/);
  assert.match(allPass, /All checks passed in/);
  assert.doesNotMatch(allPass, /role="status"/);

  const working = renderToStaticMarkup(createElement(SuiteProgress, { suite: { ...base, status: "running" }, onViewLatest: () => {} }));
  assert.match(working, /role="status"/);

  const withFindings = renderToStaticMarkup(createElement(SuiteProgress, { suite: { ...base, counts: { ...base.counts, pass: 1, fail: 1 } }, onViewLatest: () => {} }));
  assert.match(withFindings, /data-status="error"/);
  assert.match(withFindings, /Suite finished with issues after/);
});
