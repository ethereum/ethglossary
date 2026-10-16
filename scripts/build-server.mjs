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
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * `import script from "./x.js?island"` yields x.js and everything it imports
 * as one minified browser script, as a string the page inlines. Islands that
 * outgrow a template literal live as real modules this way; the rest of the
 * site's islands are still written as strings.
 */
const island = {
  name: "island",
  setup(b) {
    b.onResolve({ filter: /\?island$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?island$/, "")),
      namespace: "island",
    }))
    b.onLoad({ filter: /.*/, namespace: "island" }, async (args) => {
      const out = await build({
        entryPoints: [args.path],
        bundle: true,
        minify: true,
        format: "iife",
        target: "es2020",
        legalComments: "none",
        write: false,
        metafile: true,
      })
      return {
        contents: out.outputFiles[0].text.trim(),
        loader: "text",
        watchFiles: Object.keys(out.metafile.inputs).map((f) => path.resolve(f)),
      }
    })
  },
}

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
  plugins: [island],
  logLevel: "info",
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build(options)
}
