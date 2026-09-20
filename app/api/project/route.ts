import { NextResponse } from "next/server";
import { ProjectSchema } from "../../../lib/types";
import { saveProject } from "../../../lib/store";
import { apiError, readJson } from "../../../lib/api";

export async function PUT(request: Request) {
  try {
    const project = ProjectSchema.parse(await readJson(request));
    const saved = await saveProject(project);
    return NextResponse.json(saved);
  } catch (error) {
    return apiError(error);
  }
}
