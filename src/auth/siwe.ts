/**
 * Sign-In with Ethereum (EIP-4361).
 *
 * The browser asks for a nonce, has the wallet sign a message that names this
 * site, the nonce and an expiry, and posts message and signature back. The
 * server checks that the message is about this host, consumes the nonce, and
 * verifies the signature.
 *
 * The timestamps in the message are issued by the server along with the
 * nonce and echoed by the browser, so a device with a slow clock cannot sign
 * a message that is already expired by the time it arrives.
 *
 * With ETH_RPC_URL set, verification goes through a public client, which also
 * accepts smart-contract wallets (ERC-1271 / ERC-6492), and the address's ENS
 * name is looked up and forward-checked. Without it, only externally owned
 * accounts can sign in and there is no ENS. Either way the wallet address,
 * lowercased, is the account's identity.
 */

import { createPublicClient, getAddress, http, isAddress, verifyMessage as verifyEoaMessage } from "viem"
import type { Address, Hex, PublicClient } from "viem"
import { getEnsName, verifyMessage as verifyOnchainMessage } from "viem/actions"
import { mainnet } from "viem/chains"
import { parseSiweMessage, validateSiweMessage } from "viem/siwe"
import type { Sql } from "../db/client"
import { CHALLENGE_LIFETIME_MS, consumeChallenge, createChallenge } from "./challenges"

export class SiweError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 = 400
  ) {
    super(message)
    this.name = "SiweError"
  }
}

const clients = new Map<string, PublicClient>()

function publicClient(rpcUrl: string | null): PublicClient | null {
  if (!rpcUrl) return null
  let client = clients.get(rpcUrl)
  if (!client) {
    client = createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: 8_000 }) }) as PublicClient
    clients.set(rpcUrl, client)
  }
  return client
}

export interface SiweChallenge {
  nonce: string
  issuedAt: string
  expirationTime: string
}

/** A nonce plus the timestamps the browser must put in the message. */
export async function issueNonce(sql: Sql, nextPath: string | null): Promise<SiweChallenge> {
  const now = Date.now()
  const nonce = await createChallenge(sql, "siwe_nonce", "siwe", nextPath)
  return {
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + CHALLENGE_LIFETIME_MS).toISOString(),
  }
}

export interface SiweIdentity {
  address: Address
  /** A verified name, null when the address has none, undefined when it could not be checked. */
  ensName: string | null | undefined
  nextPath: string | null
}

/**
 * Check a signed EIP-4361 message end to end. `host` is the request's own
 * host, which the message's `domain` must equal, and the message's scheme
 * must equal the request's; together they stop a message signed for another
 * site, or for the http twin of this one, being replayed here.
 */
export async function verifySiwe(
  sql: Sql,
  host: string,
  origin: string,
  rpcUrl: string | null,
  message: unknown,
  signature: unknown
): Promise<SiweIdentity> {
  if (typeof message !== "string" || !message || message.length > 4_000) {
    throw new SiweError("message must be a string of at most 4000 characters")
  }
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 20_000) {
    throw new SiweError("signature is malformed")
  }

  const fields = parseSiweMessage(message)
  if (!fields.address || !isAddress(fields.address)) throw new SiweError("message has no valid address")
  if (!fields.nonce) throw new SiweError("message has no nonce")
  if (fields.chainId !== mainnet.id) throw new SiweError("message must be for Ethereum mainnet (chain id 1)")
  if (!fields.expirationTime) throw new SiweError("message must carry an expiration time")
  if (!fields.scheme) throw new SiweError("message must state its scheme")

  let uriOrigin: string
  try {
    uriOrigin = new URL(fields.uri ?? "").origin
  } catch {
    throw new SiweError("message URI is not a valid URL")
  }
  if (uriOrigin !== origin) throw new SiweError("message URI is not this site")

  // Scheme, domain, nonce, and the time window in one pass.
  const valid = validateSiweMessage({
    message: fields,
    scheme: new URL(origin).protocol.replace(/:$/, ""),
    domain: host,
    nonce: fields.nonce,
    time: new Date(),
  })
  if (!valid) throw new SiweError("message is not for this site, or has expired")

  const challenge = await consumeChallenge(sql, "siwe_nonce", fields.nonce)
  if (!challenge) throw new SiweError("nonce is unknown, already used, or expired; start again")

  const address = getAddress(fields.address)
  const rpc = publicClient(rpcUrl)
  const ok = rpc
    ? await verifyOnchainMessage(rpc, { address, message, signature: signature as Hex })
    : await verifyEoaMessage({ address, message, signature: signature as Hex })
  if (!ok) throw new SiweError("signature does not match the address", 401)

  // Three outcomes, kept distinct: a name, definitely no name, or could not
  // tell (no RPC, or the RPC failed). Only the first two touch the stored
  // value. viem forward-checks the reverse record, so a name that comes back
  // really does point at this address.
  let ensName: string | null | undefined = undefined
  if (rpc) {
    try {
      ensName = await getEnsName(rpc, { address })
    } catch (err) {
      console.error("ens lookup failed:", err instanceof Error ? err.message : err)
    }
  }

  return { address, ensName, nextPath: challenge.nextPath }
}
