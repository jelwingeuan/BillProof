import { AppClient } from "./ui";
import { readState } from "../lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await readState();
  return <AppClient initialState={state} />;
}
