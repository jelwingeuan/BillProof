import { NextResponse } from "next/server";
import { ProjectSchema } from "../../../lib/types";
import { saveProject } from "../../../lib/store";

export async function PUT(request: Request) {
  try {
    const project = ProjectSchema.parse(await request.json());
    const saved = await saveProject({ ...project, updatedAt: new Date().toISOString() });
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid project configuration" }, { status: 400 });
  }
}
