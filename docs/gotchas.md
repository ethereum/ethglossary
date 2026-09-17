# Gotchas (extended)

Load before any non-trivial data or API code change. The short version is in `SKILL.md`; this file has the same items with examples, blast-radius notes, and the lesson learned.

Add to this file whenever you catch a non-obvious mistake -- agentskills.io specifically calls out gotchas as the highest-value content in a skill.

## 1. Translation files are keyed by canonical term name, not by `id` slug

**Setup:** Master `confirmed_terms` keys = `"proxy contract"`. Translation file keys (e.g. `glossary-es.json`) = `"proxy contract"`. The `id` field on the entry is something like `"proxy-contract"` (kebab-case).

**Wrong:**
```typescript
const masterKeys = Object.values(getTerms()).map(t => t.id)
const translatedKeys = Object.keys(translations)
const completion = translatedKeys.filter(k => masterKeys.includes(k)).length / masterKeys.length
// ^ this always shows ~60% complete because the key shapes don't match
```

**Right:**
```typescript
const masterKeys = new Set(Object.keys(getTerms()))   // canonical term names
const translatedKeys = Object.keys(translations)
const valid = translatedKeys.filter(k => masterKeys.has(k))
```

**Why this is here:** a production bug was shipped that reported every language as ~60% complete. The fix is in `routes/translations.ts` commit `2432e2b`. Do not regress.

## 2. Three different `script_rule` value sets currently coexist

See `docs/data-shape.md` for the reconciliation table.

- **Schema enum (5):** `keep_latin, translate, transliterate, hybrid, context_dependent`
- **Bundled data (6):** `always_latin, context_dependent, hybrid, keep_latin, translate, transliterate`
- **v1 policy target (6):** `translate, calque, transliterate, keep_latin, always_latin, transliterate_with_translation`

The v1 policy removes `hybrid` and `context_dependent` (terms genuinely varying by context should be split into multiple entries) and adds `calque` and `transliterate_with_translation`. The bundled-data enum is missing `calque` and `transliterate_with_translation`; the schema enum is also missing `always_latin`.

Before changing a `script_rule` value, identify which enum you are working against and whether the change is part of the v1 migration or an unrelated edit.

## 3. `category` field is currently topical, not term-role

Current values are topical: `accounts-keys, consensus, cryptography, defi, development, ether, general, governance, identity, mev, protocol-upgrades, scaling, smart-contracts, tokens, transactions`.

The v1 policy uses `category` as term role: `concept, brand-or-project, person-name, programming-language, os-platform, cryptographic-primitive, network-name, file-extension, cli-command, ticker-or-standard, identifier`.

Do not silently change a topical category to a term role. Recommended migration path: introduce a new `term_role` field alongside `category` and decide how to reconcile the viewer and OpenAPI clients later.

## 4. Aliases can be strings OR objects

Some legacy entries are bare strings (e.g. `proof-of-stake` has the literal string `"PoS"`). New entries are objects: `{ term, status, note? }`.

Always normalize:
```typescript
const aliasStr = typeof a === "string" ? a : a.term
```

Anything that iterates aliases needs this. The surface-form index, search, and the OpenAPI response shape all do this correctly today -- check that any new code matches.

## 5. Translation files have 9 orphan entries

Translation files contain 541 entries while master `confirmed_terms` has 532. The same 9 orphans appear in all 24 language files:

```
burning  erc-1155  erc-20  erc-721  staked  staker  tx  voting  zk
```

They are not stale leftovers. Four are morphological variants of a master
term (`burning`, `staked`, `staker`, `voting`), three are DRY pattern-family
members that must NOT have master entries (`erc-20`, `erc-721`, `erc-1155` --
see the pattern-family rules in AGENTS.md), and two are abbreviations (`tx`,
`zk`). Removing them would lose real translation work; promoting the ERC ones
to master entries would violate the DRY rule.

The API filters orphans at the boundary (`routes/translations.ts`) by intersecting with master keys. Don't write any code that assumes the key sets match.

If you want to clean up the orphans, do it as a separate audited PR -- there may be intentional retentions for historical content.

## 6. Confidence is optional in data; runtime defaults to `"high"`

The schema says `confidence` is `"high" | "medium" | "low"`. Many translation entries omit the field. The runtime in `routes/translations.ts` does:

```typescript
confidence: entry.confidence ?? "high"
```

If you build code that reads confidence directly from the JSON, default to `"high"` or types will not match the Zod response schema.

## 7. `note` is only on ~40% of terms

Roughly 197/532 entries have `note`. Bonus context, not guaranteed. Do not write code that depends on its presence.

## 8. OpenAPI server URL is derived at request time

`src/index.ts` uses `app.doc31` with the function form, reading `c.req.url` and using `new URL(url).origin` for the `servers` field. The spec self-adapts to whatever host serves it.

Do not hardcode any domain in the spec. The scheme has to come from the proxy: the container is reached over plain http behind a TLS-terminating proxy, so `new URL(c.req.url).origin` says `http://` on the public site. Use `requestOrigin()` from `src/lib/request-origin.ts`, which honors `X-Forwarded-Proto` (values `http`/`https` only) and keeps the request's own host.

## 9. Worktree hazards

If this codebase is checked out as a worktree of a larger parent monorepo:

- **Do NOT run `git remote remove origin`** -- worktrees share git remotes with the parent checkout, so it removes the remote everywhere. The remote is `origin` = `git@github.com:ethereum/ethglossary.git`. Push feature branches and open a pull request; never push to `main`.
- **`pnpm install` from a worktree of a parent monorepo** will try to manage the parent's `node_modules`. Either rely on the empty `pnpm-workspace.yaml` (which already declares `packages: []` to isolate) or pass `--ignore-workspace` explicitly.

## 10. The dev server binds to `127.0.0.1` by default

`src/server.ts` listens on `HOST` (default `127.0.0.1`) and `PORT` (default `8787`); the container sets `HOST=0.0.0.0`. When SSH-tunneling for local dev, forward against `127.0.0.1`, not `localhost`. Some browsers (and some libraries) resolve `localhost` to `::1` (IPv6) which mismatches the IPv4 bind and produces confusing "connection refused" errors.

```bash
ssh -L 8787:127.0.0.1:8787 host          # right
ssh -L 8787:localhost:8787 host          # sometimes works, sometimes does not
```

## 11. Scalar's `spec` config field is type-narrowed

`@scalar/hono-api-reference`'s `apiReference()` types its config as `HtmlRenderingConfiguration` which does not formally include a `spec` field. The runtime accepts it. The cast in `src/index.ts` is:

```typescript
apiReference({
  spec: { url: "/openapi.json" },
  theme: "kepler",
  pageTitle: "ETHGlossary API",
} as Record<string, unknown>)
```

Watch for breakage on Scalar version bumps. If the cast is no longer needed, remove it.

## 12. JSON Schema is aspirational, not validating

`src/data/glossary-schema.json` describes a richer data shape than what is actually bundled and used. Specifically the schema documents `entries` keyed by slug with nested `en` and `translations`, while the runtime reads `confirmed_terms` keyed by canonical term name with translations in separate files. **The schema does not validate the bundled data.** Treat it as a design document until the migration aligns the two.

## 13. There is no Cloudflare account in the loop

Wrangler is gone from the repo; do not add it back. The app is a plain Node server (`src/server.ts`), locally through `pnpm dev` and in production as a container built from `main` by `.github/workflows/docker.yml` and rolled out by devops; see AGENTS.md "Deploy to production".

## 14. The public host is `glossary.ethereum.org`, behind a TLS-terminating proxy

The container is reached over plain http, so the request URL says `http://`. Build every absolute URL through `requestOrigin()` (see item 8). Consumers should call the URL, not the GitHub repo path; the repo is `github.com/ethereum/ethglossary`.
