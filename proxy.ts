import { NextResponse, type NextRequest } from "next/server";
import { localRequestError } from "./lib/local-boundary";

export function proxy(request: NextRequest) {
  const error = localRequestError(request);
  if (error) return NextResponse.json({ error }, { status: 403 });
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/", "/api/:path*"] };
