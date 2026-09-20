import { ZodError } from "zod";

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new RequestError("Send application/json.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("A JSON body is required.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100_000) { await reader.cancel(); throw new RequestError("Request exceeds the 100 KB limit.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function apiError(error: unknown): Response {
  if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: error.issues.map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`).join("; ") }, { status: 400 });
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON. Check the syntax and try again." }, { status: 400 });
  if (error instanceof Error && /Policy changed|Storage is busy|Import 1|catalogue is limited/.test(error.message)) return Response.json({ error: error.message }, { status: 409 });
  console.error("BillProof request failed", error);
  return Response.json({ error: "The operation could not be completed. Check the BillProof terminal and retry." }, { status: 500 });
}
