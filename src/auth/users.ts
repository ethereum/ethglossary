/**
 * Accounts.
 *
 * One row per person, one sign-in method per person, and the only thing the
 * system needs to know about them is the provider's stable id. Everything
 * else here is either vanity (display_name) or verified convenience
 * (ens_name, handle).
 */

import { randomUUID } from "node:crypto"
import type { Sql } from "../db/client"

export interface UserRow {
  id: string
  provider: string
  subject: string | null
  /** The provider's human handle at last sign-in; null for wallets. */
  handle: string | null
  display_name: string | null
  ens_name: string | null
  created_at: Date
  deleted_at: Date | null
  banned_at: Date | null
}

export class AccountBannedError extends Error {
  constructor() {
    super("this account has been disabled")
    this.name = "AccountBannedError"
  }
}

const DISPLAY_NAME_MAX = 64

/**
 * A display name is free text the person sees on their own account and
 * maintainers see in exports. Trim it, collapse whitespace, drop control
 * characters, cap the length. Empty becomes null.
 */
export function cleanDisplayName(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX)
  return cleaned || null
}

/**
 * What a sign-in learned. `undefined` means "could not tell this time" and
 * leaves the stored value alone; `null` means "definitely none" and clears
 * it. A flaky RPC must not erase a verified ENS name, and a profile response
 * without a login must not erase a handle.
 */
export interface SignInIdentity {
  handle?: string | null
  ensName?: string | null
  /** Used only when the account is created. */
  displayName: string | null
}

/**
 * The account for a (provider, subject), created on first sight, in one
 * statement so two sign-ins racing for the same identity cannot both insert.
 * A banned account is refused. A deleted account has no subject any more, so
 * the same person coming back gets a fresh row, which is the intended
 * meaning of "delete my account".
 */
export async function findOrCreateUser(
  sql: Sql,
  provider: string,
  subject: string,
  identity: SignInIdentity
): Promise<UserRow> {
  const handleKnown = identity.handle !== undefined
  const ensKnown = identity.ensName !== undefined
  const handle = cleanDisplayName(identity.handle ?? null)
  const ens = identity.ensName ?? null

  const rows = await sql<UserRow[]>`
    INSERT INTO users (id, provider, subject, handle, display_name, ens_name)
    VALUES (${randomUUID()}, ${provider}, ${subject}, ${handle}, ${cleanDisplayName(identity.displayName)}, ${ens})
    ON CONFLICT (provider, subject) DO UPDATE SET
      handle       = CASE WHEN ${handleKnown} THEN ${handle} ELSE users.handle END,
      ens_name     = CASE WHEN ${ensKnown} THEN ${ens} ELSE users.ens_name END,
      last_seen_at = now()
    WHERE users.banned_at IS NULL
    RETURNING *`
  // The conflict target matched but the WHERE did not: the row is banned.
  if (!rows[0]) throw new AccountBannedError()
  return rows[0]
}

export async function updateDisplayName(sql: Sql, id: string, value: string | null): Promise<void> {
  await sql`UPDATE users SET display_name = ${cleanDisplayName(value)} WHERE id = ${id} AND deleted_at IS NULL`
}

/**
 * Tombstone. The row stays so past feedback keeps an author id that resolves
 * to nothing; the identity is released so the person can sign up again.
 */
export async function deleteAccount(sql: Sql, id: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sessions WHERE user_id = ${id}`
    await tx`
      UPDATE users SET subject = NULL, handle = NULL, display_name = NULL, ens_name = NULL, deleted_at = now()
      WHERE id = ${id}`
  })
}

/** `0x1234…abcd`: a readable default display name for a wallet. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
