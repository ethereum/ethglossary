/**
 * The public origin of a request.
 *
 * Behind a TLS-terminating proxy the server sees plain HTTP: the proxy talks
 * to the container over http and states the public scheme in
 * X-Forwarded-Proto. Read it, so canonical links, share cards, the sitemap,
 * the OpenAPI servers entry and, later, OAuth callbacks all say https. Direct
 * traffic (local development) carries no such header and falls
 * back to the URL the runtime saw.
 *
 * Only the scheme is taken from the proxy, and only when it is literally
 * `http` or `https`. The host stays the one in the request URL: the proxy
 * already forwards the public Host, and honoring a client-supplied
 * X-Forwarded-Host would let anyone mint pages that point at a host of their
 * choosing.
 */

export interface OriginRequest {
  url: string
  header(name: string): string | undefined
}

export function requestOrigin(req: OriginRequest): string {
  const url = new URL(req.url)
  // A chain of proxies appends; the first entry is the client-facing one.
  const forwarded = req.header("x-forwarded-proto")?.split(",")[0].trim().toLowerCase()
  const proto = forwarded === "https" || forwarded === "http" ? forwarded : url.protocol.slice(0, -1)
  return `${proto}://${url.host}`
}
