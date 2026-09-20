const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function localUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use an HTTP loopback address without credentials, a path, or a query.");
  }
  return url.origin;
}

export function localRequestError(request: Request): string | undefined {
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const origin = localUrl(`http://${host}`);
    const suppliedOrigin = request.headers.get("origin");
    if (suppliedOrigin && suppliedOrigin !== origin) return "Requests must come from this BillProof window.";
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return "Cross-site requests are not allowed.";
  } catch { return "BillProof is available only through a loopback address."; }
}
