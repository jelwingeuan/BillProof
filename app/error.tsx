"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="section-card"><h1>BillProof could not load your workspace</h1><p>Your stored data has not been reset. Check the terminal for the storage error, then retry.</p><button className="btn btn-primary" onClick={reset}>Retry loading</button><p>Recovery and backup steps are in README.md.</p></main>;
}
