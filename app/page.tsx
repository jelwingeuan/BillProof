import { AppClient } from "./ui";
import { readState } from "../lib/store";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const [state, params] = await Promise.all([readState(), searchParams]);
  return <AppClient initialState={state} initialTab={typeof params.tab === "string" ? params.tab : undefined} />;
}
