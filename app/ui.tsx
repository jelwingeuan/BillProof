"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PersistedState, Project, Scenario, ScenarioRun, TargetMode } from "../lib/types";

type Tab = "overview" | "setup" | "scenarios" | "integration";
type HealthState = { state: "checking" | "ready" | "offline"; latencyMs?: number; detail?: string };
type SuiteState = {
  status: "idle" | "running" | "stopping" | "complete" | "cancelled" | "error";
  completed: number;
  total: number;
  current?: string;
};

const tabs: { id: Tab; label: string; hint: string; marker: string }[] = [
  { id: "overview", label: "Overview", hint: "Evidence & findings", marker: "01" },
  { id: "setup", label: "Policy", hint: "Plans & access rules", marker: "02" },
  { id: "scenarios", label: "Scenarios", hint: "Lifecycle checks", marker: "03" },
  { id: "integration", label: "Integration", hint: "Local target contract", marker: "04" },
];

function statusClass(status: ScenarioRun["status"]): string { return `pill pill-${status}`; }
function Status({ status }: { status: ScenarioRun["status"] }) {
  return <span className={statusClass(status)}><span aria-hidden>●</span>{status}</span>;
}
function date(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

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

export function AppClient({ initialState }: { initialState: PersistedState }) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedScenarioId, setSelectedScenarioId] = useState("stale-pre-cancellation");
  const [mode, setMode] = useState<TargetMode>("naive");
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(state.runs[0]?.id ?? null);
  const [notice, setNotice] = useState("");
  const [importText, setImportText] = useState("");
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [health, setHealth] = useState<HealthState>({ state: "checking" });
  const [suite, setSuite] = useState<SuiteState>({ status: "idle", completed: 0, total: state.scenarios.length });
  const suiteStopRequested = useRef(false);
  const actionBusy = useRef(false);
  const saveBusy = useRef(false);
  const [saving, setSaving] = useState(false);

  const project = state.projects[0];
  const selectedScenario = state.scenarios.find((item) => item.id === selectedScenarioId) ?? state.scenarios[0];
  const selectedRun = state.runs.find((item) => item.id === selectedRunId) ?? state.runs[0];
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

  async function executeScenario(scenarioId: string, targetMode: TargetMode): Promise<ScenarioRun> {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId, mode: targetMode }),
    });
    const payload = await response.json();
    if (!payload.id) throw new Error(payload.error ?? "The runner did not return a report.");
    const run = payload as ScenarioRun;
    setState((current) => ({ ...current, runs: [run, ...current.runs.filter((item) => item.id !== run.id)].slice(0, 100) }));
    return run;
  }

  async function runOne(scenarioId: string): Promise<void> {
    if (actionBusy.current || saveBusy.current) return;
    actionBusy.current = true;
    setRunningScenarioId(scenarioId); setNotice("");
    try {
      const run = await executeScenario(scenarioId, mode);
      setSelectedRunId(run.id); setTab("overview");
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
    setRunningScenarioId(scenarioId); setNotice("Running the same scenario and seed against both demo behaviors…");
    try {
      const naive = await executeScenario(scenarioId, "naive");
      const corrected = await executeScenario(scenarioId, "corrected");
      setSelectedRunId(corrected.id); setTab("overview");
      setNotice(`Comparison complete: naive ${naive.status}, corrected ${corrected.status}. Both reports use seed ${corrected.seed}.`);
    } catch (error) {
      setNotice(`Comparison error: ${error instanceof Error ? error.message : "unknown error"}`);
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
    setNotice("");
    setSuite({ status: "running", completed: 0, total: state.scenarios.length, current: state.scenarios[0]?.title });
    let completed = 0;
    let requestError = "";
    for (const item of state.scenarios) {
      if (suiteStopRequested.current) break;
      setRunningScenarioId(item.id);
      setSuite({ status: "running", completed, total: state.scenarios.length, current: item.title });
      try {
        await executeScenario(item.id, mode);
      } catch (error) {
        requestError = error instanceof Error ? error.message : "unknown suite error";
      }
      if (!requestError) completed += 1;
      setSuite({ status: suiteStopRequested.current ? "stopping" : "running", completed, total: state.scenarios.length, current: item.title });
      if (requestError) break;
    }
    actionBusy.current = false;
    setRunningScenarioId(null);
    if (suiteStopRequested.current) {
      setSuite({ status: "cancelled", completed, total: state.scenarios.length });
      setNotice(`Suite stopped after ${completed} of ${state.scenarios.length} scenarios. The in-flight run was allowed to finish and remains in evidence.`);
    } else {
      setSuite({ status: requestError ? "error" : "complete", completed, total: state.scenarios.length });
      setNotice(requestError ? `Suite stopped on an execution error: ${requestError}` : `Suite complete: ${completed} deterministic reports recorded in ${mode} mode.`);
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
    setNotice("");
    try {
      const parsed = JSON.parse(importText);
      const response = await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Scenario import was rejected.");
      const imported = payload.scenarios as Scenario[];
      setState((current) => ({ ...current, scenarios: [...current.scenarios.filter((old) => !imported.some((item) => item.id === old.id)), ...imported] }));
      setNotice(`${imported.length} JSON scenario${imported.length === 1 ? "" : "s"} validated and saved locally.`);
      setImportText("");
    } catch (error) {
      setNotice(`Scenario import error: ${error instanceof Error ? error.message : "Invalid JSON"}`);
    }
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
    <header className="app-topbar">
      <div className="brand-lockup"><span className="brand-mark" aria-hidden>◆</span><div><strong>BillProof</strong><span>Local access verifier</span></div></div>
      <div className="topbar-meta"><span className="simulation-label">Simulated billing</span><HealthBadge health={health} onRefresh={() => void checkHealth()} /></div>
    </header>

    <div className="workspace">
      <nav aria-label="BillProof sections" className="side-nav desktop-nav">
        <div className="side-nav-heading">Workspace</div>
        {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className="nav-button"><span className="nav-marker">{item.marker}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}
        <div className="side-note"><span aria-hidden>◌</span><div><strong>Bounded local test</strong><small>2s operation deadline</small></div></div>
      </nav>

      <section className="content-column">
        <nav aria-label="BillProof mobile sections" className="mobile-nav">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined}>{item.label}</button>)}</nav>
        {notice && <div role="status" className="notice"><span aria-hidden>●</span>{notice}</div>}

        {tab === "overview" && <Overview
          busy={Boolean(runningScenarioId) || saving}
          runs={state.runs} failures={failures} scenarios={scenarioById} selectedRun={selectedRun} health={health}
          onSelectRun={(run) => setSelectedRunId(run.id)} onRefreshHealth={() => void checkHealth()}
          onCompareDemo={() => void compareModes("stale-pre-cancellation")} onBrowse={() => setTab("scenarios")}
        />}
        {tab === "setup" && <fieldset className="settings-fieldset" disabled={saving || Boolean(runningScenarioId)} aria-busy={saving}><legend className="sr-only">Project settings</legend><p role="status">{saving ? "Saving changes…" : runningScenarioId ? "Settings are locked while a run is active." : "Changes save automatically."}</p><Setup project={project} onPolicy={updatePolicy} onToggle={toggleFeature} /></fieldset>}
        {tab === "scenarios" && <Scenarios
          scenarios={state.scenarios} selected={selectedScenario} mode={mode} running={runningScenarioId} suite={suite}
          query={scenarioQuery} importText={importText} health={health}
          onMode={setMode} onSelect={setSelectedScenarioId} onQuery={setScenarioQuery}
          onRun={(id) => void runOne(id)} onCompare={(id) => void compareModes(id)}
          onSuite={() => void runSuite()} onStopSuite={stopSuite}
          onImportText={setImportText} onImport={() => void importScenarios()}
        />}
        {tab === "integration" && <Integration health={health} onRefresh={() => void checkHealth()} />}
      </section>
    </div>
  </main>;
}

function HealthBadge({ health, onRefresh }: { health: HealthState; onRefresh: () => void }) {
  const label = health.state === "ready" ? `Target ready${health.latencyMs !== undefined ? ` · ${health.latencyMs}ms` : ""}` : health.state === "offline" ? "Target offline" : "Checking target";
  return <button className={`health-badge health-${health.state}`} onClick={onRefresh} aria-label={`${label}. Refresh readiness.`}><span aria-hidden>●</span>{label}</button>;
}

function Overview({ runs, failures, scenarios, selectedRun, health, onSelectRun, onRefreshHealth, onCompareDemo, onBrowse, busy }: {
  busy: boolean;
  runs: ScenarioRun[]; failures: ScenarioRun[]; scenarios: Map<string, Scenario>; selectedRun?: ScenarioRun; health: HealthState;
  onSelectRun: (run: ScenarioRun) => void; onRefreshHealth: () => void; onCompareDemo: () => void; onBrowse: () => void;
}) {
  const latest = runs[0];
  const [visibleCount, setVisibleCount] = useState(10);
  return <div className="content-stack">
    <section className="hero-panel">
      <div><p className="eyebrow">Release confidence / local proof</p><h1>Catch incorrect customer access before release.</h1><p>Replay billing lifecycles, probe protected operations, and leave with evidence your team can reproduce.</p><div className="hero-actions"><button className="btn btn-primary" onClick={onCompareDemo} disabled={busy}>{busy ? "Check in progress…" : "Compare demo targets"}</button><button className="btn btn-secondary" onClick={onBrowse}>Browse {scenarios.size} scenarios</button></div></div>
      <div className="proof-card"><div className="proof-icon" aria-hidden>✓</div><strong>Same scenario. Same seed.</strong><span>Compare a stale-event failure with the reconciled reference behavior.</span><code>stale-pre-cancellation</code></div>
    </section>

    {health.state === "offline" && <section className="offline-banner"><div><strong>Local target is not reachable.</strong><p>{health.detail ?? "Start npm run target before running a check."}</p></div><button className="btn btn-secondary" onClick={onRefreshHealth}>Check again</button></section>}

    <section className="metric-grid" aria-label="Run summary">
      <Metric label="Recorded runs" value={String(runs.length)} note="Persisted local reports" />
      <Metric label="Findings" value={String(failures.reduce((sum, run) => sum + run.findings.length, 0))} note={`${failures.length} failing run${failures.length === 1 ? "" : "s"}`} tone={failures.length ? "red" : "green"} />
      <Metric label="Latest result" value={latest ? latest.status : "—"} note={latest ? `${latest.targetMode} · ${date(latest.completedAt)}` : "No run recorded"} tone={latest?.status === "pass" ? "green" : latest ? "red" : undefined} />
    </section>

    <section className="card section-card">
      <div className="section-heading"><div><p className="eyebrow">Evidence ledger</p><h2>Recent local runs</h2><p>Every row is a persisted runner report, including deliberate demo failures.</p></div><button className="btn btn-secondary" onClick={onBrowse}>New check</button></div>
      {runs.length === 0 ? <Empty text="No runs yet. Start the sample target, then compare the demo targets." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Scenario</th><th>Behavior</th><th>Result</th><th>Findings</th><th>Evidence</th><th>Completed (UTC)</th></tr></thead><tbody>{runs.slice(0, visibleCount).map((run) => <tr key={run.id} className={selectedRun?.id === run.id ? "selected-row" : undefined}><td><button className="table-link" onClick={() => onSelectRun(run)}>{run.scenarioTitle}</button><small>{run.seed}</small></td><td className="capitalize">{run.targetMode}</td><td><Status status={run.status} /></td><td>{run.findings.length}</td><td>{run.evidence.length} records</td><td>{date(run.completedAt)}</td></tr>)}</tbody></table></div>}
    </section>
    {runs.length > visibleCount && <button className="btn btn-secondary" onClick={() => setVisibleCount((count) => count + 10)}>Show more reports ({runs.length - visibleCount} remaining)</button>}
    {selectedRun && <RunDetail key={selectedRun.id} run={selectedRun} />}
  </div>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "red" | "green" }) {
  return <div className="metric-card"><span>{label}</span><strong className={tone ? `metric-${tone}` : undefined}>{value}</strong><small>{note}</small></div>;
}
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }

function Setup({ project, onPolicy, onToggle }: { project: Project; onPolicy: <K extends keyof Project["policy"]>(key: K, value: Project["policy"][K]) => void; onToggle: (planId: string, featureId: string) => void }) {
  return <div className="content-stack"><PageHeading eyebrow="Project policy" title="Make intended access explicit" description="Map durable plan IDs to protected features, then define the lifecycle boundaries BillProof should enforce." />
    <section className="card section-card"><div className="section-heading compact"><div><h2>Plan and feature mapping</h2><p>Price references remain separate from entitlement semantics.</p></div><span className="saved-label">Autosaves locally</span></div><div className="plan-grid">{project.plans.map((plan) => <fieldset key={plan.id} className="plan-card"><legend>{plan.label}</legend><div className="plan-meta"><code>{plan.id}</code><span>{plan.priceReference}</span></div>{project.features.map((feature) => <label key={feature.id} className="feature-check"><input type="checkbox" checked={plan.featureIds.includes(feature.id)} onChange={() => onToggle(plan.id, feature.id)} /><span><strong>{feature.label}</strong><small>{feature.protectedPath}</small></span></label>)}</fieldset>)}</div></section>
    <section className="card section-card"><div className="section-heading compact"><div><h2>Lifecycle boundaries</h2><p>New runs use these rules. Existing evidence stays immutable.</p></div></div><div className="policy-grid"><Select label="Trial access" value={project.policy.trialAccess} onChange={(value) => onPolicy("trialAccess", value as Project["policy"]["trialAccess"])} options={[["purchased_plan", "Purchased plan"], ["free", "Free only"]]} /><Select label="Access during grace" value={String(project.policy.accessDuringGrace)} onChange={(value) => onPolicy("accessDuringGrace", value === "true")} options={[["true", "Allow paid plan"], ["false", "Free only"]]} /><Select label="Default cancellation" value={project.policy.cancellationDefault} onChange={(value) => onPolicy("cancellationDefault", value as Project["policy"]["cancellationDefault"])} options={[["immediate", "Immediate"], ["period_end", "Period end"]]} /></div></section>
    <p className="supporting-copy">Grace expiry and plan-change dates come from each scenario’s provider snapshots. Change those dates through scenario JSON to test other boundaries.</p>
  </div>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label><span className="label">{label}</span><select className="control" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, title]) => <option value={option} key={option}>{title}</option>)}</select></label>;
}

function Scenarios({ scenarios, selected, mode, running, suite, query, importText, health, onMode, onSelect, onQuery, onRun, onCompare, onSuite, onStopSuite, onImportText, onImport }: {
  scenarios: Scenario[]; selected?: Scenario; mode: TargetMode; running: string | null; suite: SuiteState; query: string; importText: string; health: HealthState;
  onMode: (mode: TargetMode) => void; onSelect: (id: string) => void; onQuery: (value: string) => void; onRun: (id: string) => void; onCompare: (id: string) => void;
  onSuite: () => void; onStopSuite: () => void; onImportText: (value: string) => void; onImport: () => void;
}) {
  const normalized = query.trim().toLowerCase();
  const filtered = scenarios.filter((item) => !normalized || `${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(normalized));
  const visibleSelection = filtered.find((item) => item.id === selected?.id) ?? filtered[0];
  const suiteBusy = suite.status === "running" || suite.status === "stopping";
  const percent = suite.total ? Math.round((suite.completed / suite.total) * 100) : 0;
  return <div className="content-stack"><PageHeading eyebrow="Scenario catalogue" title="Exercise the lifecycle, not just the webhook" description="Events and provider state are simulated; every protected-operation observation is a real local HTTP interaction." />
    <section className="card run-toolbar"><div><label className="label" htmlFor="target-mode">Target behavior</label><select id="target-mode" className="control" disabled={Boolean(running)} value={mode} onChange={(event) => onMode(event.target.value as TargetMode)}><option value="naive">Naive — intentionally flawed</option><option value="corrected">Corrected — reconciled reference</option></select></div><div className="toolbar-status"><span className={`service-dot service-${health.state}`} aria-hidden>●</span><strong>{health.state === "ready" ? "Target ready" : health.state === "offline" ? "Target offline" : "Checking target"}</strong><small>Runs still produce an error report when setup is unavailable.</small></div><div className="toolbar-actions">{suiteBusy ? <button className="btn btn-danger" onClick={onStopSuite} disabled={suite.status === "stopping"}>{suite.status === "stopping" ? "Stopping after current…" : "Stop after current"}</button> : <button className="btn btn-secondary" onClick={onSuite} disabled={Boolean(running)}>Run full suite</button>}</div></section>
    {suite.status !== "idle" && <section className="suite-progress" aria-live="polite"><div><strong>{suite.status === "complete" ? "Suite complete" : suite.status === "cancelled" ? "Suite stopped" : suite.status === "error" ? "Suite interrupted" : suite.status === "stopping" ? "Stopping after current run" : "Suite running"}</strong><span>{suite.completed} / {suite.total}{suite.current ? ` · ${suite.current}` : ""}</span></div><div className="progress-track" aria-label={`${percent}% complete`}><span style={{ width: `${percent}%` }} /></div></section>}
    <div className="scenario-layout"><section><div className="scenario-filter"><label><span className="sr-only">Search scenarios</span><input className="control" type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search checkout, cancellation, duplicate…" /></label><span>{filtered.length} of {scenarios.length}</span></div><div className="scenario-list">{filtered.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} className={`scenario-card ${visibleSelection?.id === item.id ? "is-selected" : ""}`}><span className="scenario-index">{String(scenarios.indexOf(item) + 1).padStart(2, "0")}</span><span className="scenario-copy"><strong>{item.title}</strong><small>{item.description}</small><span className="tag-row">{item.tags.map((tag) => <em key={tag}>{tag}</em>)}</span></span>{item.tags.includes("demo-failure") && <span className="pill pill-fail">demo fault</span>}</button>)}{filtered.length === 0 && <Empty text="No scenarios match this search." />}</div></section>
      <aside className="scenario-aside">{visibleSelection && <section className="card selection-card"><p className="eyebrow">Selected scenario</p><h2>{visibleSelection.title}</h2><p>{visibleSelection.description}</p><dl><div><dt>Stable ID</dt><dd><code>{visibleSelection.id}</code></dd></div><div><dt>Seed</dt><dd><code>{visibleSelection.seed}</code></dd></div><div><dt>Steps</dt><dd>{visibleSelection.steps.length}</dd></div></dl><button className="btn btn-primary w-full" disabled={Boolean(running)} onClick={() => onRun(visibleSelection.id)}>{running === visibleSelection.id ? "Running check…" : `Run in ${mode} mode`}</button><button className="btn btn-secondary mt-2 w-full" disabled={Boolean(running)} onClick={() => onCompare(visibleSelection.id)}>Compare naive vs corrected</button></section>}
      <details className="card import-card"><summary>Import scenario JSON</summary><p>Paste one scenario or an array. Schema validation runs before local storage.</p><textarea aria-label="Scenario JSON import" className="control mono" value={importText} onChange={(event) => onImportText(event.target.value)} placeholder='{"id":"my-scenario", ...}' /><button className="btn btn-secondary w-full" disabled={!importText.trim() || Boolean(running)} onClick={onImport}>Validate and import</button></details></aside>
    </div>
  </div>;
}

function Integration({ health, onRefresh }: { health: HealthState; onRefresh: () => void }) {
  return <div className="content-stack"><PageHeading eyebrow="Integration guide" title="A small contract with hard local boundaries" description="BillProof resets an isolated fixture, delivers simulated events, then proves access through protected operations." />
    <section className="card connection-card"><div><span className={`connection-icon service-${health.state}`} aria-hidden>●</span><div><strong>{health.state === "ready" ? "Sample target connected" : health.state === "offline" ? "Sample target offline" : "Checking sample target"}</strong><p>{health.state === "ready" ? `Loopback response in ${health.latencyMs ?? "—"}ms.` : health.detail ?? "Checking the fixed loopback target."}</p></div></div><button className="btn btn-secondary" onClick={onRefresh}>Refresh readiness</button></section>
    <section className="integration-grid"><div className="card section-card"><p className="eyebrow">Start locally</p><h2>Two processes, no credentials</h2><pre className="command-block">cd BillProof{`\n`}npm install{`\n`}npm run target{`\n\n`}# second terminal{`\n`}cd BillProof{`\n`}npm run dev</pre><p className="supporting-copy">The target listens on <code>127.0.0.1:4100</code>; the independent provider emulator listens on <code>127.0.0.1:4101</code>.</p></div><div className="card section-card"><p className="eyebrow">Safety boundary</p><h2>Explicit, isolated, loopback</h2><ul className="check-list"><li>Fixed local target contract</li><li>Namespaced customer fixtures</li><li>Two-second operation deadline</li><li>Redacted response evidence</li></ul></div></section>
    <section className="card section-card"><div className="section-heading compact"><div><h2>Implemented adapter operations</h2><p>A successful delivery is never treated as proof of product access.</p></div></div><div className="contract-grid"><ContractStep number="01" title="Reset fixture" route="POST /test/reset" text="Clear a scenario namespace and choose target behavior." /><ContractStep number="02" title="Set provider state" route=":4101/provider/state" text="Keep authoritative state separate from delivery snapshots." /><ContractStep number="03" title="Deliver and retry" route="POST /webhooks" text="Capture status, attempts, duplicate IDs, and order." /><ContractStep number="04" title="Probe operations" route="GET /protected/:feature" text="Verify what the application really permits." /></div></section>
    <section className="future-banner"><span aria-hidden>!</span><div><strong>Stripe sandbox remains a separate milestone.</strong><p>It requires isolated account association, official test clocks, raw-byte signature verification, API-version pinning, secure secret storage, and staging authorization.</p></div></section>
  </div>;
}

function ContractStep({ number, title, route, text }: { number: string; title: string; route: string; text: string }) {
  return <div className="contract-step"><span>{number}</span><strong>{title}</strong><code>{route}</code><p>{text}</p></div>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></header>;
}

function RunDetail({ run }: { run: ScenarioRun }) {
  const [copyStatus, setCopyStatus] = useState("");
  async function copyCommand() {
    const command = run.inputs ? `npm run cli -- --report \"billproof-${run.scenarioId}-${run.id}.json\"` : run.reproductionCommand;
    try { await navigator.clipboard.writeText(command); setCopyStatus(run.inputs ? "Copied. Download the report, then run beside that file." : "Copied. Legacy reports use current settings."); }
    catch { setCopyStatus(`Copy manually: ${command}`); }
  }
  const mismatches = run.observations.filter((item) => item.observedAllowed !== item.expectedAllowed).length;
  return <section className="card report-card" aria-label="Run report"><header className="report-header"><div><p className="eyebrow">Run report / {run.id}</p><div className="report-title"><h2>{run.scenarioTitle}</h2><Status status={run.status} /></div><p>{run.targetMode} behavior · seed {run.seed} · completed {date(run.completedAt)} UTC</p></div><div className="report-actions"><a className="btn btn-secondary" href={`/api/export?run=${encodeURIComponent(run.id)}`} download>Download report</a><button className="btn btn-secondary" onClick={() => void copyCommand()}>Copy replay command</button><span role="status">{copyStatus}</span></div></header>
    <div className="report-metrics"><Metric label="Observations" value={String(run.observations.length)} note="Protected operations" /><Metric label="Mismatches" value={String(mismatches)} note="Expected vs observed" tone={mismatches ? "red" : "green"} /><Metric label="Deliveries" value={String(run.deliveryAttempts.length)} note="In recorded order" /><Metric label="HTTP records" value={String(run.evidence.length)} note="Redacted evidence" /></div>
    {run.error && <div className="error-banner"><strong>Execution error</strong><span>{run.error}</span></div>}
    {run.findings.length > 0 && <section className="report-section"><div className="section-heading compact"><div><p className="eyebrow">Requires attention</p><h3>{run.findings.length} access finding{run.findings.length === 1 ? "" : "s"}</h3></div></div><div className="finding-grid">{run.findings.map((finding) => <article key={finding.id} className="finding-card"><div><span className="pill pill-fail">{finding.severity}</span><code>{finding.featureId ?? "side effect"}</code></div><h4>{finding.title}</h4><p><strong>Expected:</strong> {finding.expected}<br /><strong>Observed:</strong> {finding.observed}</p><p><strong>Hypothesis:</strong> {finding.rootCauseHypothesis.replace(/^Hypothesis:\s*/i, "")}</p><p><strong>Suggested fix:</strong> {finding.suggestedFix}</p></article>)}</div></section>}
    <section className="report-section"><div className="section-heading compact"><div><p className="eyebrow">Access matrix</p><h3>Expected versus observed</h3></div></div><div className="table-wrap"><table className="data-table access-table"><thead><tr><th>Checkpoint / virtual time</th><th>Feature</th><th>Expected</th><th>Observed</th><th>Evidence</th></tr></thead><tbody>{run.observations.length === 0 ? <tr><td colSpan={5}>No observations were reached.</td></tr> : run.observations.map((item, index) => <tr key={`${item.checkpoint}-${item.featureId}-${index}`} className={item.expectedAllowed !== item.observedAllowed ? "mismatch-row" : undefined}><td>{item.checkpoint}<small>{item.observedAt}</small></td><td><code>{item.featureId}</code></td><td><AccessValue allowed={item.expectedAllowed} /></td><td><AccessValue allowed={item.observedAllowed} /></td><td><span className="http-code">{item.httpStatus ?? "—"}</span> {item.evidenceType.replace("_", " ")}</td></tr>)}</tbody></table></div></section>
    <section className="report-section"><div className="section-heading compact"><div><p className="eyebrow">Delivery timeline</p><h3>Scenario time is separate from arrival order</h3></div></div><div className="timeline">{run.deliveryAttempts.map((item) => <div className="timeline-item" key={item.id}><span>{item.ordinal}</span><div><strong>{item.eventId}</strong><code>{item.deliveredAt}</code></div><div><em>{item.outcome}</em><small>HTTP {item.httpStatus ?? "unreachable"}</small></div></div>)}</div></section>
    <details className="evidence-disclosure"><summary>Inspect HTTP evidence <span>{run.evidence.length} records</span></summary><div className="evidence-list">{run.evidence.map((item, index) => <article key={`${item.label}-${index}`}><div><strong>{item.label}</strong><span>{item.responseStatus ?? "network error"} · {item.elapsedMs}ms</span></div><code>{item.method} {item.url}</code><pre>request: {item.requestSummary || "—"}{`\n`}response: {item.responseBody || "—"}</pre></article>)}</div></details>
  </section>;
}

function AccessValue({ allowed }: { allowed: boolean | null }) {
  return <span className={`access-value ${allowed === null ? "is-unknown" : allowed ? "is-allowed" : "is-denied"}`}><span aria-hidden>{allowed === null ? "?" : allowed ? "✓" : "—"}</span>{allowed === null ? "Unavailable" : allowed ? "Allowed" : "Denied"}</span>;
}
