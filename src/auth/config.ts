/**
 * Sign-in configuration, read once from the environment.
 *
 * A provider is offered only when its credentials are present, so the
 * sign-in page on a machine with no Discord app simply has no Discord button.
 * SIWE needs no credentials; ETH_RPC_URL is optional and only adds ENS names
 * and smart-contract-wallet verification.
 *
 * The *_ORIGIN overrides exist for local end-to-end tests against a mock
 * provider. They are not in .env.example and have no reason to be set in
 * production.
 */

export type OAuthProviderId = "github" | "discord"

export interface OAuthProvider {
  id: OAuthProviderId
  label: string
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  userUrl: string
  /** Requested at authorization time. Empty means the provider's minimum. */
  scope: string
  /** Pull the stable id and the human handle out of the profile response. */
  profile(json: Record<string, unknown>): { subject: string; handle: string | null } | null
}

export interface AuthConfig {
  providers: OAuthProvider[]
  siwe: { rpcUrl: string | null }
}

function strip(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v.replace(/\/+$/, "") : null
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const providers: OAuthProvider[] = []

  const gh = { id: env.GITHUB_CLIENT_ID?.trim(), secret: env.GITHUB_CLIENT_SECRET?.trim() }
  if (gh.id && gh.secret) {
    const oauthOrigin = strip(env.GITHUB_OAUTH_ORIGIN) ?? "https://github.com"
    const apiOrigin = strip(env.GITHUB_API_ORIGIN) ?? "https://api.github.com"
    providers.push({
      id: "github",
      label: "GitHub",
      clientId: gh.id,
      clientSecret: gh.secret,
      authorizeUrl: `${oauthOrigin}/login/oauth/authorize`,
      tokenUrl: `${oauthOrigin}/login/oauth/access_token`,
      userUrl: `${apiOrigin}/user`,
      // No scope: read-only access to public profile information, which is
      // all /user needs to return the numeric id and login.
      scope: "",
      profile: (j) =>
        typeof j.id === "number" || typeof j.id === "string"
          ? { subject: String(j.id), handle: typeof j.login === "string" ? j.login : null }
          : null,
    })
  }

  const dc = { id: env.DISCORD_CLIENT_ID?.trim(), secret: env.DISCORD_CLIENT_SECRET?.trim() }
  if (dc.id && dc.secret) {
    const origin = strip(env.DISCORD_ORIGIN) ?? "https://discord.com"
    providers.push({
      id: "discord",
      label: "Discord",
      clientId: dc.id,
      clientSecret: dc.secret,
      authorizeUrl: `${origin}/oauth2/authorize`,
      tokenUrl: `${origin}/api/oauth2/token`,
      userUrl: `${origin}/api/users/@me`,
      // `identify` is Discord's smallest scope: id, username, avatar, flags.
      // No email.
      scope: "identify",
      profile: (j) =>
        typeof j.id === "string"
          ? { subject: j.id, handle: typeof j.username === "string" ? j.username : null }
          : null,
    })
  }

  return { providers, siwe: { rpcUrl: strip(env.ETH_RPC_URL) } }
}

let config: AuthConfig | null = null

export function authConfig(): AuthConfig {
  if (!config) config = loadAuthConfig()
  return config
}

/** For tests that change the environment between runs. */
export function resetAuthConfig(): void {
  config = null
}

export function oauthProvider(id: string): OAuthProvider | undefined {
  return authConfig().providers.find((p) => p.id === id)
}
