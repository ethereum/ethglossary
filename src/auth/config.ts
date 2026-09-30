/**
 * Sign-in configuration, read once from the environment.
 *
 * A provider is offered only when its credentials are present, so the
 * sign-in page on a machine with no Discord app simply has no Discord button.
 * SIWE needs no credentials; ETH_RPC_URL is optional and only adds ENS names
 * and smart-contract-wallet verification.
 *
 * The *_ORIGIN overrides exist for local end-to-end tests against a mock
 * provider. They are ignored, with a warning, when NODE_ENV is production:
 * a stray variable there could send the token exchange, client secret
 * included, to a host of someone's choosing.
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
  /**
   * Pull the stable id and the human handle out of the profile response.
   * `handle: undefined` means the response did not say, which leaves any
   * stored handle alone.
   */
  profile(json: Record<string, unknown>): { subject: string; handle: string | undefined } | null
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
  const production = env.NODE_ENV === "production"
  const override = (name: string, fallback: string): string => {
    const value = strip(env[name])
    if (!value) return fallback
    if (production) {
      console.warn(`ignoring ${name} in production; provider endpoints are not configurable there`)
      return fallback
    }
    return value
  }

  const providers: OAuthProvider[] = []

  const gh = { id: env.GITHUB_CLIENT_ID?.trim(), secret: env.GITHUB_CLIENT_SECRET?.trim() }
  if (gh.id && gh.secret) {
    const oauthOrigin = override("GITHUB_OAUTH_ORIGIN", "https://github.com")
    const apiOrigin = override("GITHUB_API_ORIGIN", "https://api.github.com")
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
          ? { subject: String(j.id), handle: typeof j.login === "string" ? j.login : undefined }
          : null,
    })
  }

  const dc = { id: env.DISCORD_CLIENT_ID?.trim(), secret: env.DISCORD_CLIENT_SECRET?.trim() }
  if (dc.id && dc.secret) {
    const origin = override("DISCORD_ORIGIN", "https://discord.com")
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
          ? { subject: j.id, handle: typeof j.username === "string" ? j.username : undefined }
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

export function oauthProvider(id: string): OAuthProvider | undefined {
  return authConfig().providers.find((p) => p.id === id)
}
