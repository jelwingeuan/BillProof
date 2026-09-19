import { NextResponse } from "next/server";
import { readState } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load local state" }, { status: 500 });
  }
}
