#!/usr/bin/env node
/**
 * Remove an account, the maintainer's side of the toolkit.
 *
 *   DATABASE_URL=postgres://... node scripts/remove-user.mjs <user_id> [--ban] [--purge] [--dry-run]
 *
 * By default the account is tombstoned exactly as self-deletion does: the
 * identity is released, sessions are removed, and the person's feedback
 * stays as one anonymous author. `--ban` keeps the identity and sets
 * banned_at instead, so that provider account can never sign in again.
 * `--purge` also deletes the person's votes, suggestions and proposals --
 * for spam, not for disagreement.
 *
 * User ids come from the export (`author.id`). Nothing here touches the
 * glossary.
 */

import postgres from "postgres"

const args = process.argv.slice(2)
const userId = args.find((a) => !a.startsWith("--"))
const ban = args.includes("--ban")
const purge = args.includes("--purge")
const dryRun = args.includes("--dry-run")

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required")
  process.exit(2)
}
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  console.error("usage: remove-user.mjs <user_id> [--ban] [--purge] [--dry-run]")
  process.exit(2)
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
const [user] = await sql`SELECT id, provider, subject, handle, display_name, deleted_at, banned_at FROM users WHERE id = ${userId}`
if (!user) {
  console.error("no such user")
  await sql.end()
  process.exit(1)
}
console.error(`user ${user.id}: ${user.provider} ${user.handle ?? user.subject ?? "(no identity)"}${user.deleted_at ? " [deleted]" : ""}${user.banned_at ? " [banned]" : ""}`)

const counts = await sql`
  SELECT (SELECT COUNT(*) FROM votes WHERE user_id = ${userId})::int AS votes,
         (SELECT COUNT(*) FROM suggestions WHERE user_id = ${userId})::int AS suggestions,
         (SELECT COUNT(*) FROM proposals WHERE user_id = ${userId})::int AS proposals,
         (SELECT COUNT(*) FROM field_votes WHERE user_id = ${userId})::int AS field_votes,
         (SELECT COUNT(*) FROM sessions WHERE user_id = ${userId})::int AS sessions`
console.error(`  ${counts[0].votes} votes, ${counts[0].field_votes} definition votes, ${counts[0].suggestions} suggestions, ${counts[0].proposals} proposals, ${counts[0].sessions} sessions`)
console.error(`  action: ${ban ? "ban (identity kept, refused at sign-in)" : "tombstone (identity released)"}${purge ? " + purge all feedback" : ""}`)

if (dryRun) {
  console.error("dry run: nothing written")
  await sql.end()
  process.exit(0)
}

await sql.begin(async (tx) => {
  await tx`DELETE FROM sessions WHERE user_id = ${userId}`
  if (purge) {
    await tx`DELETE FROM votes WHERE user_id = ${userId}`
    await tx`DELETE FROM field_votes WHERE user_id = ${userId}`
    await tx`DELETE FROM suggestions WHERE user_id = ${userId}`
    await tx`DELETE FROM proposals WHERE user_id = ${userId}`
  }
  if (ban) {
    await tx`UPDATE users SET banned_at = now(), display_name = NULL WHERE id = ${userId}`
  } else {
    await tx`UPDATE users SET subject = NULL, handle = NULL, display_name = NULL, ens_name = NULL, deleted_at = now() WHERE id = ${userId}`
  }
})
await sql.end()
console.error("done")
