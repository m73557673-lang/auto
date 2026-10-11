export default async (request: Request) => {
  const backendUrl = Netlify.env.get("BACKEND_API_URL")?.replace(/\/$/, "");
  const apiToken = Netlify.env.get("COMMANDER_API_TOKEN");

  if (!backendUrl || !apiToken) {
    return Response.json({ detail: "The backend proxy is not configured." }, { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = `${backendUrl}${incomingUrl.pathname}${incomingUrl.search}`;
  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${apiToken}`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    signal: AbortSignal.timeout(50_000),
  });

  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};

export const config = {
  path: "/api/*",
  rateLimit: {
    action: "rate_limit" as const,
    aggregateBy: "ip" as const,
    windowSize: 60,
    windowLimit: 60,
  },
};
