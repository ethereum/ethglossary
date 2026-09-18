#!/usr/bin/env node
/**
 * Local development: rebuild the server bundle on every source change and
 * restart Node after each successful rebuild. Loads `.env.local` if present,
 * so OAuth and database settings never have to be exported by hand.
 *
 * The restart is driven from esbuild's build events rather than `node
 * --watch`: watch mode insists on watching the env file too and exits when
 * it does not exist, and it leans on inotify limits that are easy to exhaust
 * on a machine with several worktrees.
 */

import { context } from "esbuild"
import { spawn } from "node:child_process"
import { options } from "./build-server.mjs"

let child = null

function start() {
  child = spawn(process.execPath, ["--env-file-if-exists=.env.local", "dist/server.js"], {
    stdio: "inherit",
    env: process.env,
  })
  child.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`server exited with ${code}`)
  })
}

function restart() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      start()
      return resolve()
    }
    child.once("exit", () => {
      start()
      resolve()
    })
    child.kill("SIGTERM")
  })
}

const ctx = await context({
  ...options,
  logLevel: "warning",
  plugins: [
    {
      name: "restart-server",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) await restart()
        })
      },
    },
  ],
})

// watch() runs the first build, which starts the server through onEnd.
await ctx.watch()

async function stop() {
  if (child && child.exitCode === null) child.kill("SIGTERM")
  await ctx.dispose()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
