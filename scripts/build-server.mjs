#!/usr/bin/env node
/**
 * Bundle the server into one file, dist/server.js.
 *
 * esbuild resolves the JSON data, the `.txt` and `.svg` imports (as text) and
 * every dependency into a single ESM file, so the runtime image needs Node and
 * nothing else -- no node_modules, no package manager. `scripts/dev.mjs`
 * reuses these options in watch mode.
 */

import { build } from "esbuild"
import { pathToFileURL } from "node:url"

export const options = {
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  loader: { ".txt": "text", ".svg": "text" },
  jsx: "automatic",
  jsxImportSource: "hono/jsx",
  // A few dependencies are CommonJS and call require() for Node builtins at
  // runtime; give the ESM bundle a require to hand them.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  logLevel: "info",
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build(options)
}
