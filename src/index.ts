import { OpenAPIHono } from "@hono/zod-openapi"
import { apiReference } from "@scalar/hono-api-reference"
import { cors } from "hono/cors"

import llmsTxt from "./llms.txt"
import { DOCS_BRAND } from "./ui/docs-brand"
import viewer, { notFoundHandler } from "./routes/viewer"
import info from "./routes/info"
import styleGuide from "./routes/style-guide"
import translations from "./routes/translations"
import filter from "./routes/filter"
import schema from "./routes/schema"
import { requestOrigin } from "./lib/request-origin"
import { cacheControl } from "./lib/cache-control"

const app = new OpenAPIHono()

/*
 * `/translations/` should not 404 when `/translations` works.
 *
 * Acts only on a response that already came back 404, so it costs nothing on
 * a path that matched and never touches `/`. The 301 keeps one canonical URL
 * per page rather than two.
 *
 * Not Hono's trimTrailingSlash: that builds an absolute Location from the URL
 * the runtime saw, which behind the TLS-terminating proxy is http://. A
 * relative Location keeps whatever scheme the browser arrived on.
 */
app.use("*", async (c, next) => {
  await next()
  const { method, path } = c.req
  if (
    c.res.status === 404 &&
    (method === "GET" || method === "HEAD") &&
    path !== "/" &&
    path.endsWith("/")
  ) {
    c.res = c.redirect(path.slice(0, -1) + new URL(c.req.url).search, 301)
  }
})

// CORS -- public API, allow all origins for reads
app.use("*", cors())

// Cache headers for read endpoints -- see docs/design-decisions.md, "Caching"
app.use("/api/v1/info/*", cacheControl("public, max-age=3600"))
app.use("/api/v1/style-guide/*", cacheControl("public, max-age=86400, stale-while-revalidate=604800"))
app.use("/api/v1/languages", cacheControl("public, max-age=86400"))
app.use("/api/v1/translations/*", cacheControl("public, max-age=86400, stale-while-revalidate=604800"))
app.use("/api/v1/schema", cacheControl("public, max-age=604800"))

// Mount versioned routes
app.route("/api/v1", info)
app.route("/api/v1", styleGuide)
app.route("/api/v1", translations)
app.route("/api/v1", filter)
app.route("/api/v1", schema)

// OpenAPI spec. Server URL derived from the incoming request so this works
// regardless of which host/domain the API is served from. See
// src/lib/request-origin.ts for why the scheme comes from the proxy.
app.doc31("/openapi.json", (c) => {
  return {
    openapi: "3.1.0",
    info: {
      title: "ETHGlossary API",
      version: "0.1.0",
      description:
        "Ethereum terminology glossary and style guide. Canonical translations for 24 languages, English usage rules, and content-aware term filtering for translation pipelines.",
      license: {
        name: "MPL-2.0",
        url: "https://www.mozilla.org/en-US/MPL/2.0/",
      },
    },
    servers: [{ url: requestOrigin(c.req) }],
  }
})

// Scalar API docs
/*
 * Pinned, path and all.
 *
 * The default is `cdn.jsdelivr.net/npm/@scalar/api-reference`, which 302s to
 * `@latest/dist/browser/standalone.js` -- so whatever Scalar publishes runs on
 * our docs page, on every load, with no commit here. That is a third-party
 * script with an LLM feature attached; it should not change under us.
 *
 * The path matters as much as the version: `@scalar/api-reference@1.68.0` with
 * no path resolves to the package main entry, a different and much larger
 * bundle than the standalone build the default redirect lands on.
 *
 * To bump: check the release notes, change the version here, and confirm
 * /docs still renders. `@scalar/hono-api-reference` in package.json only
 * generates the HTML -- it does not control which bundle the browser loads.
 */
const SCALAR_CDN =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0/dist/browser/standalone.js"

/*
 * Scalar renders a standalone document with no link back to the site, so the
 * wordmark is injected into its sidebar afterwards. See src/ui/docs-brand.ts
 * for why this is a wrapper rather than a config option.
 */
const scalar = apiReference({
  spec: { url: "/openapi.json" },
  theme: "kepler",
  pageTitle: "ETHGlossary API",
  cdn: SCALAR_CDN,
} as Record<string, unknown>)

app.get("/docs", async (c) => {
  // The Scalar handler always returns a Response; `next` is never called.
  const res = (await scalar(c, async () => {})) as Response
  const html = await res.text()
  return c.html(
    html
      .replace("</head>", `<link rel="icon" href="/favicon.svg" type="image/svg+xml" /></head>`)
      .replace("</body>", `${DOCS_BRAND}</body>`)
  )
})

// LLM-friendly description
app.get("/llms.txt", (c) => {
  return c.text(llmsTxt)
})

// Viewer (root)
app.route("/", viewer)

// Hono only consults the top-level handler, so the viewer's 404 page has to
// be registered here rather than on the sub-app. It keeps JSON for /api/*.
app.notFound(notFoundHandler)

export default app
