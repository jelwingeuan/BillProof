"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PersistedState, Project, Scenario, ScenarioRun, TargetMode } from "../lib/types";
import LatticeLoader from "../components/react-bits/LatticeLoader";

type Tab = "overview" | "policy" | "scenarios" | "connection";
type HealthState = { state: "checking" | "ready" | "offline"; latencyMs?: number; detail?: string };
type SuiteState = {
  status: "idle" | "running" | "stopping" | "complete" | "cancelled" | "error";
  completed: number;
  total: number;
  current?: string;
  startedAtMs?: number;
  elapsedSeconds?: number;
  counts: Record<ScenarioRun["status"], number>;
};
type ComparisonState = { scenarioTitle: string; runs: ScenarioRun[]; status: "running" | "complete" | "error"; error?: string };
const emptyCounts = (): SuiteState["counts"] => ({ pass: 0, fail: 0, error: 0, skipped: 0 });

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "policy", label: "Policy" },
  { id: "scenarios", label: "Scenarios" },
  { id: "connection", label: "Connection" },
];
const parseTab = (value?: string | null): Tab => tabs.find((item) => item.id === value)?.id ?? "overview";
const tabFromUrl = (url: URL): Tab => {
  const values = url.searchParams.getAll("tab");
  return values.length === 1 ? parseTab(values[0]) : "overview";
};
const runFromUrl = (url: URL): string | null => {
  const values = url.searchParams.getAll("run");
  return values.length === 1 && values[0] ? values[0] : null;
};
const reportHref = (id: string): string => `/?run=${encodeURIComponent(id)}#run-report`;

function statusClass(status: ScenarioRun["status"]): string { return `pill pill-${status}`; }
function Status({ status }: { status: ScenarioRun["status"] }) {
  return <span className={statusClass(status)}><span aria-hidden>●</span>{status}</span>;
}
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
const preciseDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "medium" });
function date(value: string): string { return dateFormatter.format(new Date(value)); }
function preciseDate(value: string): string { return preciseDateFormatter.format(new Date(value)); }

async function fetchHealthState(): Promise<HealthState> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const payload = await response.json() as { ready?: boolean; latencyMs?: number; detail?: string };
    return payload.ready
      ? { state: "ready", latencyMs: payload.latencyMs }
      : { state: "offline", latencyMs: payload.latencyMs, detail: payload.detail ?? "Start the local target and try again." };
  } catch (error) {
    return { state: "offline", detail: error instanceof Error ? error.message : "Readiness check failed." };
  }
}

export function AppClient({ initialState, initialTab, initialRunId }: { initialState: PersistedState; initialTab?: string; initialRunId?: string }) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<Tab>(parseTab(initialTab));
  const [selectedScenarioId, setSelectedScenarioId] = useState(state.scenarios[0]?.id ?? "");
  const [mode, setMode] = useState<TargetMode>("corrected");
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId ?? state.runs[0]?.id ?? null);
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const [importText, setImportText] = useState("");
  const [replaceExistingScenarios, setReplaceExistingScenarios] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [health, setHealth] = useState<HealthState>({ state: "checking" });
  const [suite, setSuite] = useState<SuiteState>({ status: "idle", completed: 0, total: state.scenarios.length, counts: emptyCounts() });
  const suiteStopRequested = useRef(false);
  const actionBusy = useRef(false);
  const saveBusy = useRef(false);
  const importBusy = useRef(false);
  const focusImportedScenario = useRef(false);
  const focusReport = useRef(Boolean(initialRunId));
  const focusComparison = useRef(false);
  const focusTabHeading = useRef(false);
  const [saving, setSaving] = useState(false);

  const project = state.projects[0];
  const selectedScenario = state.scenarios.find((item) => item.id === selectedScenarioId) ?? state.scenarios[0];
  const selectedRun = selectedRunId ? state.runs.find((item) => item.id === selectedRunId) : undefined;
  const latestRunId = state.runs[0]?.id ?? null;
  const failures = state.runs.filter((run) => run.status === "fail");
  const scenarioById = useMemo(() => new Map(state.scenarios.map((item) => [item.id, item])), [state.scenarios]);

  const checkHealth = useCallback(async () => {
    setHealth({ state: "checking" });
    setHealth(await fetchHealthState());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchHealthState().then((result) => { if (active) setHealth(result); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const syncUrl = () => {
      const url = new URL(window.location.href);
      const next = tabFromUrl(url);
      const requestedRunId = runFromUrl(url);
      const runId = requestedRunId ?? latestRunId;
      focusReport.current = next === "overview" && Boolean(runId) && (tab === "overview" || Boolean(requestedRunId));
      focusTabHeading.current = !focusReport.current;
      setSelectedRunId(runId);
      setTab(next);
    };
    window.addEventListener("popstate", syncUrl);
    return () => window.removeEventListener("popstate", syncUrl);
  }, [latestRunId, tab]);

  useEffect(() => {
    if (tab !== "overview" || !focusReport.current) return;
    const report = document.getElementById("run-report");
    report?.scrollIntoView({ block: "start" });
    report?.focus({ preventScroll: true });
    focusReport.current = false;
  }, [tab, selectedRunId]);

  useEffect(() => {
    if (tab !== "overview" || !focusComparison.current) return;
    const results = document.getElementById("comparison-results");
    results?.scrollIntoView({ block: "start" });
    results?.focus({ preventScroll: true });
    focusComparison.current = false;
  }, [tab, comparison]);

  useEffect(() => {
    if (!focusTabHeading.current) return;
    const heading = document.querySelector<HTMLElement>("#workspace-content h1");
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    focusTabHeading.current = false;
  }, [tab]);

  useEffect(() => {
    if (tab !== "scenarios" || !focusImportedScenario.current) return;
    const selection = document.getElementById("selected-scenario");
    if (!selection) return;
    selection.scrollIntoView({ block: "start" });
    selection.focus({ preventScroll: true });
    focusImportedScenario.current = false;
  }, [tab, selectedScenarioId, scenarioQuery, state.scenarios]);

  function showTab(next: Tab, focusHeading = false): void {
    const url = new URL(window.location.href);
    const currentUrlTab = tabFromUrl(url);
    if (currentUrlTab === next && tab === next) return;
    if (next === "overview") {
      url.searchParams.delete("tab");
      if (selectedRunId) url.searchParams.set("run", selectedRunId);
      else url.searchParams.delete("run");
    } else url.searchParams.set("tab", next);
    url.hash = "";
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    focusTabHeading.current = focusHeading;
    setTab(next);
  }

  function navigateToTab(next: Tab): void { showTab(next, true); }

  function showReport(runId: string): void {
    const url = new URL(reportHref(runId), window.location.href);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    focusReport.current = true;
    setSelectedRunId(runId);
    setTab("overview");
    if (tab === "overview" && selectedRunId === runId) {
      const report = document.getElementById("run-report");
      report?.scrollIntoView({ block: "start" });
      report?.focus({ preventScroll: true });
      focusReport.current = false;
    }
  }

  function selectReportLink(run: ScenarioRun, event: MouseEvent<HTMLAnchorElement>): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showReport(run.id);
  }

  async function executeScenario(scenarioId: string, targetMode: TargetMode): Promise<ScenarioRun> {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId, mode: targetMode }),
    });
    const payload = await response.json();
    if (!payload.id) throw new Error(payload.error ?? "The runner did not return a report.");
    const run = payload as ScenarioRun;
    setState((current) => ({ ...current, runs: [run, ...current.runs.filter((item) => item.id !== run.id)] }));
    return run;
  }

  async function runOne(scenarioId: string): Promise<void> {
    if (actionBusy.current || saveBusy.current) return;
    actionBusy.current = true;
    setComparison(null);
    setRunningScenarioId(scenarioId); setNotice("");
    try {
      const run = await executeScenario(scenarioId, mode);
      showReport(run.id);
      setNotice(run.status === "pass"
        ? "Scenario passed with protected-operation evidence."
        : run.status === "fail" ? "Finding captured. Review the evidence below." : `Run error: ${run.error ?? "unknown error"}`);
    } catch (error) {
      setNotice(`Run error: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      actionBusy.current = false;
      setRunningScenarioId(null);
      void checkHealth();
    }
  }

  async function compareModes(scenarioId: string): Promise<void> {
    if (actionBusy.current || saveBusy.current) return;
    actionBusy.current = true;
    setSelectedScenarioId(scenarioId);
    setComparison({ scenarioTitle: scenarioById.get(scenarioId)?.title ?? scenarioId, runs: [], status: "running" });
    focusComparison.current = true;
    setSelectedRunId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tab");
    url.searchParams.delete("run");
    url.hash = "";
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setTab("overview");
    setRunningScenarioId(scenarioId); setNotice("Running the same scenario and seed against both demo behaviors…");
    try {
      const naive = await executeScenario(scenarioId, "naive");
      setComparison((current) => current ? { ...current, runs: [naive] } : null);
      setSelectedRunId(naive.id);
      const corrected = await executeScenario(scenarioId, "corrected");
      setComparison((current) => current ? { ...current, runs: [naive, corrected], status: "complete" } : null);
      setSelectedRunId(corrected.id);
      setNotice(`Comparison complete: naive ${naive.status}, corrected ${corrected.status}. Both reports use seed ${corrected.seed}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setComparison((current) => current ? { ...current, status: "error", error: message } : null);
      setNotice(`Comparison error: ${message}`);
    } finally {
      actionBusy.current = false;
      setRunningScenarioId(null);
      void checkHealth();
    }
  }

  async function runSuite(): Promise<void> {
    if (actionBusy.current || saveBusy.current) return;
    actionBusy.current = true;
    suiteStopRequested.current = false;
    setComparison(null);
    setNotice("");
    const counts = emptyCounts();
    const startedAtMs = performance.now();
    setSuite({ status: "running", completed: 0, total: state.scenarios.length, current: state.scenarios[0]?.title, startedAtMs, counts: { ...counts } });
    let completed = 0;
    let requestError = "";
    let lastRun: ScenarioRun | undefined;
    for (const item of state.scenarios) {
      if (suiteStopRequested.current) break;
      setRunningScenarioId(item.id);
      setSuite({ status: "running", completed, total: state.scenarios.length, current: item.title, startedAtMs, counts: { ...counts } });
      try {
        const run = await executeScenario(item.id, mode);
        counts[run.status] += 1;
        lastRun = run;
      } catch (error) {
        requestError = error instanceof Error ? error.message : "unknown suite error";
      }
      if (!requestError) completed += 1;
      setSuite({ status: suiteStopRequested.current ? "stopping" : "running", completed, total: state.scenarios.length, current: item.title, startedAtMs, counts: { ...counts } });
      if (requestError) break;
    }
    actionBusy.current = false;
    setRunningScenarioId(null);
    if (lastRun) setSelectedRunId(lastRun.id);
    const elapsedSeconds = Math.max(0, (performance.now() - startedAtMs) / 1000);
    if (suiteStopRequested.current) {
      setSuite({ status: "cancelled", completed, total: state.scenarios.length, startedAtMs, elapsedSeconds, counts: { ...counts } });
      setNotice(`Suite stopped after ${completed} of ${state.scenarios.length} scenarios. The in-flight run was allowed to finish and remains in evidence.`);
    } else {
      setSuite({ status: requestError ? "error" : "complete", completed, total: state.scenarios.length, startedAtMs, elapsedSeconds, counts: { ...counts } });
      setNotice(requestError ? `Suite stopped on a request error: ${requestError}` : `Suite complete: ${counts.pass} passed, ${counts.fail} with findings, ${counts.error} errors, ${counts.skipped} skipped.`);
    }
    void checkHealth();
  }

  function stopSuite(): void {
    suiteStopRequested.current = true;
    setSuite((current) => ({ ...current, status: "stopping" }));
  }

  async function saveProject(next: Project): Promise<void> {
    if (saveBusy.current || actionBusy.current) return;
    saveBusy.current = true;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/project", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Project update was rejected.");
      setState((current) => ({ ...current, projects: [payload as Project, ...current.projects.slice(1)] }));
      setNotice("Project policy saved locally. Existing reports remain unchanged; new runs use this policy.");
    } catch (error) {
      setNotice(`Could not save configuration: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally { saveBusy.current = false; setSaving(false); }
  }

  async function importScenarios(): Promise<void> {
    if (importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    setNotice("");
    try {
      const parsed = JSON.parse(importText);
      const response = await fetch(replaceExistingScenarios ? "/api/scenarios?replace=1" : "/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Scenario import was rejected.");
      const imported = payload.scenarios as Scenario[];
      setState((current) => ({ ...current, scenarios: [...current.scenarios.filter((old) => !imported.some((item) => item.id === old.id)), ...imported] }));
      setScenarioQuery("");
      setSelectedScenarioId(imported[0].id);
      focusImportedScenario.current = true;
      setNotice(`${imported.length} JSON scenario${imported.length === 1 ? "" : "s"} validated and saved locally. The first imported scenario is selected.${replaceExistingScenarios ? " Matching IDs were replaced where present." : ""}`);
      setImportText("");
      setReplaceExistingScenarios(false);
    } catch (error) {
      setNotice(`Scenario import error: ${error instanceof Error ? error.message : "Invalid JSON"}`);
    } finally { importBusy.current = false; setImporting(false); }
  }

  function updatePolicy<K extends keyof Project["policy"]>(key: K, value: Project["policy"][K]): void {
    void saveProject({ ...project, policy: { ...project.policy, [key]: value } });
  }

  function toggleFeature(planId: string, featureId: string): void {
    const plans = project.plans.map((plan) => plan.id !== planId ? plan : {
      ...plan,
      featureIds: plan.featureIds.includes(featureId) ? plan.featureIds.filter((item) => item !== featureId) : [...plan.featureIds, featureId],
    });
    const changed = plans.find((item) => item.id === planId);
    if (changed && changed.featureIds.length === 0) { setNotice("A plan must include at least one feature."); return; }
    void saveProject({ ...project, plans });
  }

  return <main className="app-shell">
    <a className="skip-link" href="#workspace-content">Skip to workspace</a>
    <header className="app-topbar">
      <div className="brand-lockup"><span className="brand-mark" aria-hidden="true" /><div><strong>BillProof</strong><span>Local access verifier</span></div></div>
      <nav aria-label="BillProof sections" className="top-nav">{tabs.map((item) => <button key={item.id} onClick={() => navigateToTab(item.id)} aria-current={tab === item.id ? "page" : undefined}>{item.label}</button>)}</nav>
      <div className="topbar-meta"><span className="simulation-label">Simulated billing</span><HealthBadge health={health} onRefresh={() => void checkHealth()} /></div>
    </header>

    <div className="workspace">
      <section className="content-column" id="workspace-content" tabIndex={-1}>
        {notice && <div role="status" className="notice"><span aria-hidden>●</span><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}

        {tab === "overview" && <Overview
          busy={Boolean(runningScenarioId) || saving}
          runs={state.runs} failures={failures} scenarios={scenarioById} selectedRun={selectedRun} health={health}
          comparison={comparison}
          missingRun={Boolean(selectedRunId && !selectedRun)}
          onSelectRun={selectReportLink} onRefreshHealth={() => void checkHealth()}
          onCompareDemo={() => void compareModes("stale-pre-cancellation")} onBrowse={() => navigateToTab("scenarios")}
        />}
        {tab === "policy" && <fieldset className="settings-fieldset" disabled={saving || Boolean(runningScenarioId)} aria-busy={saving}><legend className="sr-only">Project settings</legend><Setup project={project} onPolicy={updatePolicy} onToggle={toggleFeature} /><p role="status">{saving ? "Saving changes…" : runningScenarioId ? "Settings are locked while a run is active." : "Changes save automatically."}</p></fieldset>}
        {tab === "scenarios" && <Scenarios
          scenarios={state.scenarios} selected={selectedScenario} mode={mode} running={runningScenarioId} suite={suite}
          query={scenarioQuery} importText={importText} replaceExisting={replaceExistingScenarios} importing={importing} health={health}
          onMode={setMode} onSelect={setSelectedScenarioId} onQuery={setScenarioQuery}
          onRun={(id) => void runOne(id)} onCompare={(id) => void compareModes(id)}
          onSuite={() => void runSuite()} onStopSuite={stopSuite}
          onViewLatest={() => { if (selectedRunId) showReport(selectedRunId); else showTab("overview", true); }}
          onImportText={setImportText} onReplaceExisting={setReplaceExistingScenarios} onImport={() => void importScenarios()}
        />}
        {tab === "connection" && <Integration health={health} onRefresh={() => void checkHealth()} />}
      </section>
    </div>
  </main>;
}

function HealthBadge({ health, onRefresh }: { health: HealthState; onRefresh: () => void }) {
  const label = health.state === "ready" ? `Target ready${health.latencyMs !== undefined ? ` · ${health.latencyMs}ms` : ""}` : health.state === "offline" ? "Target offline" : "Checking target";
  return <button className={`health-badge health-${health.state}`} onClick={onRefresh} aria-label={`${label}. Refresh readiness.`}><span aria-hidden>●</span>{label}</button>;
}

function Overview({ runs, failures, scenarios, selectedRun, missingRun, health, comparison, onSelectRun, onRefreshHealth, onCompareDemo, onBrowse, busy }: {
  busy: boolean;
  runs: ScenarioRun[]; failures: ScenarioRun[]; scenarios: Map<string, Scenario>; selectedRun?: ScenarioRun; missingRun: boolean; health: HealthState;
  comparison: ComparisonState | null;
  onSelectRun: (run: ScenarioRun, event: MouseEvent<HTMLAnchorElement>) => void; onRefreshHealth: () => void; onCompareDemo: () => void; onBrowse: () => void;
}) {
  const latest = runs[0];
  const [visibleCount, setVisibleCount] = useState(10);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const search = query.trim().toLowerCase();
  const filtered = runs.filter((run) => (resultFilter === "all" || run.status === resultFilter) && (
    !search || `${run.scenarioTitle} ${run.targetMode} ${run.id} ${run.inputs?.scenario.customerId ?? run.findings[0]?.customerId ?? ""} ${run.completedAt} ${preciseDate(run.completedAt)}`.toLowerCase().includes(search)
  ));
  return <div className="content-stack">
    <section className="hero-panel">
      <p className="hero-kicker">BillProof / verification workbench</p>
      <h1 tabIndex={-1}>Verify subscription access.</h1>
      <p className="hero-description">Run simulated billing events, probe protected operations, and inspect every mismatch in a replayable report.</p>
      <div className="hero-actions"><button className="btn btn-primary" onClick={onCompareDemo} disabled={busy || health.state !== "ready"}>{busy ? "Comparing targets…" : "Compare demo targets"}</button><button className="btn btn-secondary" onClick={onBrowse}>Browse {scenarios.size} scenarios</button></div>
      {health.state !== "ready" && <p className="hero-status" role="status">{health.state === "checking" ? "Checking sample target before checks can run." : "Start the sample target to enable checks."}</p>}
    </section>

    {health.state === "offline" && <section className="offline-banner"><div><strong>Start the target to enable checks</strong><p>In another terminal, open the BillProof folder and run <code>npm run target</code>. Keep it running, then check the connection.</p><details><summary>Connection details</summary><p>{health.detail}</p></details></div><button className="btn btn-secondary" onClick={onRefreshHealth}>Check connection</button></section>}

    {comparison && <section className="card section-card" id="comparison-results" tabIndex={-1} aria-label="Comparison results"><div className="section-heading compact"><div><p className="eyebrow">Same scenario, both behaviors</p><h2>Compare the outcomes</h2><p>{comparison.scenarioTitle}</p></div><span className={`comparison-state comparison-state-${comparison.status}`}>{comparison.status === "complete" ? "Both reports saved" : comparison.status === "error" ? "Comparison incomplete" : "Comparison in progress"}</span></div><div className="comparison-grid">{comparison.runs.map((run) => <a href={reportHref(run.id)} className={`comparison-result ${selectedRun?.id === run.id ? "is-selected" : ""}`} key={run.id} onClick={(event) => onSelectRun(run, event)}><div><strong>{run.targetMode === "naive" ? "Intentionally flawed" : "Corrected reference"}</strong><Status status={run.status} /></div><span>{run.status === "error" ? "Check could not finish" : `${run.findings.length} findings · ${run.observations.length} access checks`}</span><small>View report →</small></a>)}{comparison.runs.length < 2 && <div className="comparison-pending"><strong>{comparison.runs.length ? "Corrected reference" : "Intentionally flawed"}</strong>{comparison.status === "error" ? <p>Could not finish: {comparison.error ?? "Unknown error"}</p> : <LatticeLoader label={comparison.runs.length ? "Checking corrected reference" : "Checking flawed target"} color="#f0642e" doneColor="#40bd89" errorColor="#e86c62" fontSize={13} />}</div>}</div></section>}

    <section className="metric-grid" aria-label="Run summary">
      <Metric label="Recorded runs" value={String(runs.length)} note="Persisted local reports" />
      <Metric label="Findings" value={String(failures.reduce((sum, run) => sum + run.findings.length, 0))} note={`${failures.length} failing run${failures.length === 1 ? "" : "s"}`} tone={failures.length ? "red" : runs.length > 0 && runs.every((run) => run.status === "pass") ? "green" : undefined} />
      <Metric label="Latest result" value={latest ? latest.status : "—"} note={latest ? `${latest.targetMode} · ${date(latest.completedAt)}` : "No run recorded"} tone={latest?.status === "pass" ? "green" : latest?.status === "fail" ? "red" : latest?.status === "error" ? "amber" : undefined} />
    </section>

    {missingRun && <div className="notice" role="alert">This report is not saved on this device. Choose an available report from Run history below.</div>}
    {selectedRun && <RunDetail key={selectedRun.id} run={selectedRun} />}
    <section className="card section-card" id="run-history" aria-label="Run history">
      <div className="section-heading"><div><p className="eyebrow">Saved on this device</p><h2>Run history</h2><p>Open a report to inspect or replay a previous check.</p></div><button className="btn btn-secondary" onClick={onBrowse}>New check</button></div>
      {runs.length > 0 && <div className="history-filters"><label><span className="label">Find a report</span><input type="search" className="control" placeholder="Search title, ID, customer, or UTC date…" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(10); }} /></label><label><span className="label">Result</span><select className="control" value={resultFilter} onChange={(event) => { setResultFilter(event.target.value); setVisibleCount(10); }}><option value="all">All results</option><option value="fail">Findings</option><option value="error">Errors</option><option value="pass">Passed</option><option value="skipped">Skipped</option></select></label><span role="status">{filtered.length} reports</span></div>}
      {runs.length === 0 ? <Empty text="Your first report will appear here. Start with Compare demo targets above." /> : filtered.length === 0 ? <div className="empty-state"><p>No reports match these filters.</p><button className="btn btn-secondary" onClick={() => { setQuery(""); setResultFilter("all"); }}>Clear filters</button></div> : <ul className="history-list">{filtered.slice(0, visibleCount).map((run) => <li key={run.id}><a href={reportHref(run.id)} aria-current={selectedRun?.id === run.id ? "true" : undefined} onClick={(event) => onSelectRun(run, event)}><div className="history-title"><strong>{run.scenarioTitle}</strong><span>{run.targetMode} · {preciseDate(run.completedAt)} UTC · <code title={run.id}>{run.id.slice(0, 12)}</code></span></div><span className="history-findings">{run.findings.length} findings{run.warnings?.length ? " · cleanup warning" : ""}</span><Status status={run.status} /><span aria-hidden>↗</span></a></li>)}</ul>}
      {filtered.length > visibleCount && <button className="btn btn-secondary mt-4" onClick={() => setVisibleCount((count) => count + 10)}>Show 10 more reports</button>}
    </section>
  </div>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "red" | "green" | "amber" }) {
  return <div className="metric-card"><span>{label}</span><strong className={tone ? `metric-${tone}` : undefined}>{value}</strong><small>{note}</small></div>;
}
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }

function Setup({ project, onPolicy, onToggle }: { project: Project; onPolicy: <K extends keyof Project["policy"]>(key: K, value: Project["policy"][K]) => void; onToggle: (planId: string, featureId: string) => void }) {
  return <div className="content-stack"><PageHeading title="Access policy" description="Map plan IDs to protected features and set the billing lifecycle rules used by each check." />
    <section className="card section-card"><div className="section-heading compact"><div><h2>Plan and feature mapping</h2><p>Price references remain separate from entitlement semantics.</p></div><span className="saved-label">Autosaves locally</span></div><div className="plan-grid">{project.plans.map((plan) => <fieldset key={plan.id} className="plan-card"><legend>{plan.label}</legend><div className="plan-meta"><code>{plan.id}</code><span>{plan.priceReference}</span></div>{project.features.map((feature) => <label key={feature.id} className="feature-check"><input type="checkbox" checked={plan.featureIds.includes(feature.id)} onChange={() => onToggle(plan.id, feature.id)} /><span><strong>{feature.label}</strong><small>{feature.protectedPath}</small></span></label>)}</fieldset>)}</div></section>
    <section className="card section-card"><div className="section-heading compact"><div><h2>Lifecycle boundaries</h2><p>New runs use these rules. Existing evidence stays immutable.</p></div></div><div className="policy-grid"><Select label="Trial access" value={project.policy.trialAccess} onChange={(value) => onPolicy("trialAccess", value as Project["policy"]["trialAccess"])} options={[["purchased_plan", "Purchased plan"], ["free", "Free only"]]} /><Select label="Access during grace" value={String(project.policy.accessDuringGrace)} onChange={(value) => onPolicy("accessDuringGrace", value === "true")} options={[["true", "Allow paid plan"], ["false", "Free only"]]} /><Select label="Default cancellation" value={project.policy.cancellationDefault} onChange={(value) => onPolicy("cancellationDefault", value as Project["policy"]["cancellationDefault"])} options={[["immediate", "Immediate"], ["period_end", "Period end"]]} /></div></section>
    <p className="supporting-copy">Grace expiry and plan-change dates come from each scenario’s provider snapshots. Change those dates through scenario JSON to test other boundaries.</p>
  </div>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label><span className="label">{label}</span><select className="control" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, title]) => <option value={option} key={option}>{title}</option>)}</select></label>;
}

function Scenarios({ scenarios, selected, mode, running, suite, query, importText, replaceExisting, importing, health, onMode, onSelect, onQuery, onRun, onCompare, onSuite, onStopSuite, onViewLatest, onImportText, onReplaceExisting, onImport }: {
  scenarios: Scenario[]; selected?: Scenario; mode: TargetMode; running: string | null; suite: SuiteState; query: string; importText: string; replaceExisting: boolean; importing: boolean; health: HealthState;
  onMode: (mode: TargetMode) => void; onSelect: (id: string) => void; onQuery: (value: string) => void; onRun: (id: string) => void; onCompare: (id: string) => void;
  onSuite: () => void; onStopSuite: () => void; onViewLatest: () => void; onImportText: (value: string) => void; onReplaceExisting: (value: boolean) => void; onImport: () => void;
}) {
  const selectionCardRef = useRef<HTMLElement>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = scenarios.filter((item) => !normalized || `${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(normalized));
  const visibleSelection = filtered.find((item) => item.id === selected?.id) ?? filtered[0];
  const suiteBusy = suite.status === "running" || suite.status === "stopping";
  const runningTitle = scenarios.find((item) => item.id === running)?.title ?? running;
  function selectFromList(id: string): void {
    onSelect(id);
    if (window.matchMedia("(max-width: 820px)").matches) {
      requestAnimationFrame(() => {
        selectionCardRef.current?.focus({ preventScroll: true });
        selectionCardRef.current?.scrollIntoView({ block: "start" });
      });
    }
  }
  return <div className="content-stack"><PageHeading title="Scenarios" description="Check cancellations, failed payments, upgrades, and event delivery against the access policy." />
    <section className="card run-toolbar"><div><label className="label" htmlFor="target-mode">Target behavior</label><select id="target-mode" className="control" disabled={Boolean(running)} value={mode} onChange={(event) => onMode(event.target.value as TargetMode)}><option value="naive">Naive — intentionally flawed</option><option value="corrected">Corrected — reconciled reference</option></select></div><div className="toolbar-status"><span className={`service-dot service-${health.state}`} aria-hidden>●</span><strong>{health.state === "ready" ? "Target ready" : health.state === "offline" ? "Target offline" : "Checking target"}</strong><small>{health.state === "ready" ? "Each check saves a report with observed access." : "Start npm run target, then refresh the badge above."}</small></div><div className="toolbar-actions">{suiteBusy ? <button className="btn btn-danger" onClick={onStopSuite} disabled={suite.status === "stopping"}>{suite.status === "stopping" ? "Stopping after current…" : "Stop after current"}</button> : <button className="btn btn-secondary" onClick={onSuite} disabled={Boolean(running) || health.state !== "ready"}>Run full suite</button>}</div></section>
    {suite.status !== "idle" && <SuiteProgress suite={suite} onViewLatest={onViewLatest} />}
    <div className="scenario-layout"><section>{visibleSelection && <a className="scenario-jump-link" href="#selected-scenario">Run selected scenario ↓</a>}<div className="scenario-filter"><label><span className="sr-only">Search scenarios</span><input className="control" type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search checkout, cancellation, duplicate…" /></label><span>{filtered.length} of {scenarios.length}</span></div><div className="scenario-list">{filtered.map((item) => <button key={item.id} onClick={() => selectFromList(item.id)} aria-pressed={visibleSelection?.id === item.id} className={`scenario-card ${visibleSelection?.id === item.id ? "is-selected" : ""}`}><span className="scenario-index">{String(scenarios.indexOf(item) + 1).padStart(2, "0")}</span><span className="scenario-copy"><strong>{item.title}</strong><small>{item.description}</small><span className="tag-row">{item.tags.map((tag) => <em key={tag}>{tag}</em>)}</span></span>{item.tags.includes("demo-failure") && <span className="pill pill-fail">demo fault</span>}</button>)}{filtered.length === 0 && <Empty text="No scenarios match this search." />}</div></section>
      <aside className="scenario-aside">
        {running && !suiteBusy && <div className="check-progress"><LatticeLoader label="Checking access" color="#f0642e" fontSize={13} /><p className="supporting-copy" style={{ marginTop: 8 }}>Running {runningTitle}</p></div>}
        {visibleSelection && <section id="selected-scenario" ref={selectionCardRef} tabIndex={-1} aria-labelledby="selected-scenario-heading" className="card selection-card"><label className="scenario-quick-select"><span className="label">Scenario to run</span><select className="control" value={visibleSelection.id} onChange={(event) => onSelect(event.target.value)}>{filtered.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><p className="eyebrow">Selected scenario</p><h2 id="selected-scenario-heading">{visibleSelection.title}</h2><p>{visibleSelection.description}</p><dl><div><dt>Stable ID</dt><dd><code>{visibleSelection.id}</code></dd></div><div><dt>Seed</dt><dd><code>{visibleSelection.seed}</code></dd></div><div><dt>Steps</dt><dd>{visibleSelection.steps.length}</dd></div></dl><button className="btn btn-primary w-full" disabled={Boolean(running) || health.state !== "ready"} onClick={() => onRun(visibleSelection.id)}>{running === visibleSelection.id ? "Running check…" : `Run in ${mode} mode`}</button><button className="btn btn-secondary mt-2 w-full" disabled={Boolean(running) || health.state !== "ready"} onClick={() => onCompare(visibleSelection.id)}>Compare naive vs corrected</button></section>}
      <details className="card import-card"><summary>Import scenario JSON</summary><p>Paste one scenario or an array. Schema validation runs before local storage. Existing IDs are kept unless you choose to replace them.</p><textarea aria-label="Scenario JSON import" className="control mono" value={importText} onChange={(event) => onImportText(event.target.value)} placeholder='{"id":"my-scenario", ...}' disabled={importing || Boolean(running)} /><label className="import-replace-option"><input type="checkbox" checked={replaceExisting} onChange={(event) => onReplaceExisting(event.target.checked)} disabled={importing || Boolean(running)} /><span><strong>Replace matching IDs</strong><small>Overwrites saved scenario definitions. Existing reports stay unchanged.</small></span></label><button className="btn btn-secondary w-full" disabled={!importText.trim() || Boolean(running) || importing} onClick={onImport}>{importing ? "Importing…" : replaceExisting ? "Validate and replace" : "Validate and import"}</button></details></aside>
    </div>
  </div>;
}

export function SuiteProgress({ suite, onViewLatest }: { suite: SuiteState; onViewLatest: () => void }) {
  const busy = suite.status === "running" || suite.status === "stopping";
  const allPassed = suite.status === "complete" && suite.total > 0 && suite.completed === suite.total && suite.counts.pass === suite.total;
  const status = allPassed ? "done" : busy ? "working" : "error";
  const errorLabel = suite.status === "cancelled" ? "Suite stopped after" : suite.status === "error" ? "Suite interrupted after" : "Suite finished with issues after";
  const percent = suite.total ? Math.round((suite.completed / suite.total) * 100) : 0;
  return <section className="suite-progress"><div><LatticeLoader status={status} announce={busy} label={suite.status === "stopping" ? "Stopping suite" : "Running suite"} doneLabel="All checks passed in" errorLabel={errorLabel} startedAtMs={suite.startedAtMs} elapsed={busy ? undefined : suite.elapsedSeconds} color="#f0642e" doneColor="#6ed7a7" errorColor="#ff8179" fontSize={13} /><span>{suite.completed} / {suite.total}{suite.current ? ` · ${suite.current}` : ""}</span></div><div className="progress-track" role="progressbar" aria-label="Suite progress" aria-valuenow={suite.completed} aria-valuemin={0} aria-valuemax={suite.total}><span style={{ width: `${percent}%` }} /></div><div className="suite-outcomes"><span>{suite.counts.pass} passed</span><span>{suite.counts.fail} with findings</span><span>{suite.counts.error} errors</span><span>{suite.counts.skipped} skipped</span>{!busy && suite.completed > 0 && <button className="btn btn-secondary" onClick={onViewLatest}>View latest report</button>}</div></section>;
}

function Integration({ health, onRefresh }: { health: HealthState; onRefresh: () => void }) {
  return <div className="content-stack"><PageHeading title="Local connection" description="BillProof resets an isolated fixture, delivers simulated events, then probes protected operations." />
    <section className="card connection-card"><div><span className={`connection-icon service-${health.state}`} aria-hidden>●</span><div><strong>{health.state === "ready" ? "Sample target connected" : health.state === "offline" ? "Sample target offline" : "Checking sample target"}</strong><p>{health.state === "ready" ? `Loopback response in ${health.latencyMs ?? "—"}ms.` : health.detail ?? "Checking the fixed loopback target."}</p></div></div><button className="btn btn-secondary" onClick={onRefresh}>Refresh readiness</button></section>
    <section className="integration-grid"><div className="card section-card"><p className="eyebrow">Start locally</p><h2>Two processes, no credentials</h2><pre className="command-block">cd BillProof{`\n`}npm ci{`\n`}npm run build{`\n`}npm run target{`\n\n`}# second terminal{`\n`}cd BillProof{`\n`}npm start</pre><p className="supporting-copy">The target listens on <code>127.0.0.1:4100</code>; the independent provider emulator listens on <code>127.0.0.1:4101</code>. For source edits, use <code>npm run dev</code> instead of <code>npm start</code>.</p></div><div className="card section-card"><p className="eyebrow">Safety boundary</p><h2>Explicit, isolated, loopback</h2><ul className="check-list"><li>Fixed local target contract</li><li>Namespaced customer fixtures</li><li>Two-second operation deadline</li><li>Inspect evidence before sharing</li></ul></div></section>
    <section className="card section-card"><div className="section-heading compact"><div><h2>Implemented adapter operations</h2><p>A successful delivery is never treated as proof of product access.</p></div></div><ol className="contract-grid"><ContractStep title="Reset fixture" route="POST /test/reset" text="Clear a scenario namespace and choose target behavior." /><ContractStep title="Set provider state" route=":4101/provider/state" text="Keep authoritative state separate from delivery snapshots." /><ContractStep title="Deliver and retry" route="POST /webhooks" text="Capture status, attempts, duplicate IDs, and order." /><ContractStep title="Probe operations" route="GET /protected/:feature" text="Verify what the application really permits." /></ol></section>
    <section className="future-banner"><span aria-hidden>!</span><div><strong>Stripe sandbox remains a separate milestone.</strong><p>It requires isolated account association, official test clocks, raw-byte signature verification, API-version pinning, secure secret storage, and staging authorization.</p></div></section>
  </div>;
}

function ContractStep({ title, route, text }: { title: string; route: string; text: string }) {
  return <li className="contract-step"><strong>{title}</strong><code>{route}</code><p>{text}</p></li>;
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <header className="page-heading"><h1 tabIndex={-1}>{title}</h1><p>{description}</p></header>;
}

function RunDetail({ run }: { run: ScenarioRun }) {
  const [copyStatus, setCopyStatus] = useState("");
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  async function copyCommand() {
    const command = run.inputs ? `npm run cli -- --report \"billproof-${run.scenarioId}-${run.id}.json\"` : run.reproductionCommand;
    try { await navigator.clipboard.writeText(command); setCopyStatus(run.inputs ? "Copied. Download the report, then run beside that file." : "Copied. Legacy reports use current settings."); }
    catch { setCopyStatus(`Copy manually: ${command}`); }
  }
  const mismatches = run.observations.filter((item) => item.observedAllowed !== item.expectedAllowed).length;
  const observations = onlyMismatches ? run.observations.filter((item) => item.observedAllowed !== item.expectedAllowed) : run.observations;
  const verdict = run.status === "pass" ? "All recorded checks matched the rules." : run.status === "fail" ? `${run.findings.length} finding${run.findings.length === 1 ? " needs" : "s need"} your attention.` : run.status === "error" ? "This check could not finish." : "This check was skipped.";
  return <section id="run-report" tabIndex={-1} className="card report-card" aria-label="Run report"><header className="report-header"><div><p className="eyebrow">Selected report</p><div className="report-title"><h2>{run.scenarioTitle}</h2><Status status={run.status} /></div><p>{run.targetMode} behavior · customer fixture <code>{run.inputs?.scenario.customerId ?? run.findings[0]?.customerId ?? "unavailable in legacy report"}</code> · completed {date(run.completedAt)} UTC</p></div><div className="report-actions"><a className="btn btn-secondary" href={`/api/export?run=${encodeURIComponent(run.id)}`} download>Download report</a><button className="btn btn-secondary" onClick={() => void copyCommand()}>Copy replay command</button><span role="status">{copyStatus}</span></div></header>
    <div className={`report-verdict verdict-${run.status}`}><strong>{verdict}</strong><p>{run.status === "pass" ? "This result covers this scenario and policy. Explore other lifecycle checks for broader coverage." : run.status === "fail" ? run.targetMode === "naive" ? "This target is intentionally flawed. Compare with the corrected reference to see the difference." : "Review the findings and expected access below, then replay the report to investigate." : run.status === "error" ? "An incomplete run is not a pass. Check the error and your local connection before retrying." : "No verification result is available for this run."}</p></div>
    <div className="report-metrics"><Metric label="Observations" value={String(run.observations.length)} note="Protected operations" /><Metric label="Mismatches" value={String(mismatches)} note="Expected vs observed" tone={mismatches ? "red" : run.status === "pass" && run.observations.length > 0 ? "green" : undefined} /><Metric label="Deliveries" value={String(run.deliveryAttempts.length)} note="In recorded order" /><Metric label="HTTP records" value={String(run.evidence.length)} note="Captured responses" /></div>
    {run.error && <div className="error-banner"><strong>Execution error</strong><span>{run.error}</span></div>}
    {run.warnings?.map((warning, index) => <div className="error-banner" role="status" key={index}><strong>Cleanup warning</strong><span>{warning}</span></div>)}
    {run.findings.length > 0 && <section className="report-section"><div className="section-heading compact"><div><p className="eyebrow">Requires attention</p><h3>{run.findings.length} access finding{run.findings.length === 1 ? "" : "s"}</h3></div></div><div className="finding-grid">{run.findings.map((finding) => <article key={finding.id} className="finding-card"><div><span className="pill pill-fail">{finding.severity}</span><code>{finding.featureId ?? "side effect"}</code></div><h4>{finding.title}</h4><p><strong>Expected:</strong> {finding.expected}<br /><strong>Observed:</strong> {finding.observed}</p><p><strong>Hypothesis:</strong> {finding.rootCauseHypothesis.replace(/^Hypothesis:\s*/i, "")}</p><p><strong>Suggested fix:</strong> {finding.suggestedFix}</p></article>)}</div></section>}
    <section className="report-section"><div className="section-heading compact"><div><p className="eyebrow">Access checks</p><h3>Expected versus observed</h3></div>{mismatches > 0 && <button className="btn btn-secondary" aria-pressed={onlyMismatches} onClick={() => setOnlyMismatches(!onlyMismatches)}>{onlyMismatches ? "Show all checks" : `Only mismatches (${mismatches})`}</button>}</div><div className="table-wrap" tabIndex={0} role="region" aria-label="Access checks"><table className="data-table access-table"><thead><tr><th>Checkpoint / virtual time</th><th>Feature</th><th>Expected</th><th>Observed</th><th>Evidence</th></tr></thead><tbody>{observations.length === 0 ? <tr><td colSpan={5}>No observations were reached.</td></tr> : observations.map((item, index) => <tr key={`${item.checkpoint}-${item.featureId}-${index}`} className={item.expectedAllowed !== item.observedAllowed ? "mismatch-row" : undefined}><td data-label="Checkpoint">{item.checkpoint}<small>{item.observedAt}</small></td><td data-label="Feature"><code>{item.featureId}</code></td><td data-label="Expected"><AccessValue allowed={item.expectedAllowed} /></td><td data-label="Observed"><AccessValue allowed={item.observedAllowed} /></td><td data-label="Evidence"><span className="http-code">{item.httpStatus ?? "—"}</span> {item.evidenceType.replace("_", " ")}</td></tr>)}</tbody></table></div></section>
    <section className="report-section"><div className="section-heading compact"><div><p className="eyebrow">Delivery timeline</p><h3>Scenario time is separate from arrival order</h3></div></div><div className="timeline">{run.deliveryAttempts.map((item) => <div className="timeline-item" key={item.id}><span>{item.ordinal}</span><div><strong>{item.eventId}</strong><code>{item.deliveredAt}</code></div><div><em>{item.outcome}</em><small>HTTP {item.httpStatus ?? "unreachable"}</small></div></div>)}</div></section>
    <details className="evidence-disclosure"><summary>Inspect HTTP evidence <span>{run.evidence.length} records</span></summary><div className="evidence-list">{run.evidence.map((item, index) => <article key={`${item.label}-${index}`}><div><strong>{item.label}</strong><span>{item.responseStatus ?? "network error"} · {item.elapsedMs}ms</span></div><code>{item.method} {item.url}</code><pre>request: {item.requestSummary || "—"}{`\n`}response: {item.responseBody || "—"}</pre></article>)}</div></details>
  </section>;
}

function AccessValue({ allowed }: { allowed: boolean | null }) {
  return <span className={`access-value ${allowed === null ? "is-unknown" : allowed ? "is-allowed" : "is-denied"}`}><span aria-hidden>{allowed === null ? "?" : allowed ? "✓" : "—"}</span>{allowed === null ? "Unavailable" : allowed ? "Allowed" : "Denied"}</span>;
}
