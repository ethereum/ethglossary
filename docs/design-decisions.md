# Design decisions

Load when tempted to introduce a new framework, dependency, storage layer, or to break a v1 convention. These are settled decisions -- relitigating them costs the user time and they are unlikely to change without strong new evidence.

## Stack

**Hono + @hono/zod-openapi + @scalar/hono-api-reference, shipped as a container.**

Reasoning:
- Runtime-portable: the same app ran on Cloudflare Workers and now runs in a container on Ethereum Foundation infrastructure with no application code change. No Google/AWS dependency.
- Zod schemas double as runtime validation and OpenAPI source. Auto-generated docs are a real win we lose if we migrate to Next.js, NestJS, or a framework with separate validation and docs systems.
- TypeScript everywhere; esbuild bundles the server into a single file, Tailwind compiles the stylesheet.

Do not migrate to Next.js or another framework without a strong reason. "I want server components" is not strong enough.

## Storage

**Glossary JSON is bundled into the build.**

Reasoning:
- ~15MB of data, loaded once at startup.
- Read-only data -- no need for a database.
- Bundling eliminates a request hop and keeps cold-start latency tiny.

Phase 2 (designed, not built) adds a database for community feedback. The store is **Postgres**, provisioned and run by Ethereum Foundation devops and handed to the app as a `DATABASE_URL` environment variable. Not a third-party hosted database, not anything Google-touched. The schema is plain SQL in `migrations/`, to be applied by the app itself at startup, so it stays portable. Feedback is advisory: the database never changes what the site or API serves.

## Versioning and API stability

**`/api/v1/` prefix from day one. Breaking changes to the public contract get a new major version.**

The repo uses pragmatic semver:

- **Patch** (0.x.y -> 0.x.y+1): data corrections, typo fixes, audit-script changes, docs-only updates, anything invisible to API consumers.
- **Minor** (0.x.0 -> 0.x+1.0): additive changes -- new optional response fields, new endpoints, new master entries, new pattern families in `content-filter.ts`, internal refactors with no contract change.
- **Major** (pre-1.0: encoded in a minor bump with a CHANGELOG callout; post-1.0: `0.x -> 1.0` or `1.x -> 2.x`): any change to the public contract. Breaking changes also require a new `/api/vN/` route prefix.

### What is public (changes require a version bump)

- Endpoint paths under `/api/v1/` and the root meta-paths (`/openapi.json`, `/docs`, `/llms.txt`).
- Request shapes for each endpoint (per the auto-generated OpenAPI spec at `/openapi.json`).
- Response shapes: field names, types, optionality, enum values that appear in responses.
- Semantic behavior: same input must produce the same response shape, modulo additive optional fields.

The OpenAPI spec at `/openapi.json` is the source of truth. If the OpenAPI declares it, it is part of the public contract.

### What is internal (may change without a major bump)

- The internal shape of `src/data/glossary-terms-enhanced.json` beyond what the API exposes (e.g., `content_occurrences`, `content_files`, `sources`).
- `src/data/glossary-schema.json` -- aspirational; does not validate runtime data today.
- `src/lib/*` helper code, the surface-form index construction.
- `scripts/audit-glossary.mjs` heuristics, report shape, and the term_role assignment logic.
- Enum values that are stored in data but not exposed in API responses.

### Breaking change examples (major bump or `/api/v2/`)

- Removing or renaming a response field.
- Tightening a Zod enum (removing a value from `casing`, `script_rule`, etc.).
- Changing the semantics of an existing field.
- Removing or renaming an endpoint.
- Changing `/api/v1/filter` matching so existing source content produces different matches for the same terms.
- Removing a master entry that a known surface form has resolved to.

### Non-breaking change examples (minor or patch)

- Adding a new optional response field.
- Adding a new endpoint.
- Adding a new pattern family in `STANDARD_PATTERNS` (existing matches unchanged; new matches appear).
- Adding a new master entry (existing entries unaffected; filter may return additional matches in `/filter`).
- Correcting a `script_rule` value on an existing entry (the field value is exposed, but the change reflects existing-policy accuracy, not a contract change). If in doubt, flag in the commit message and bump minor.
- Updating a translation string (the response shape stays the same; the string content changes).

### Deprecation policy

To deprecate a field or endpoint pre-1.0:

1. Update the OpenAPI description to call out the deprecation and the replacement (if any).
2. Keep serving correctly for at least one minor version.
3. Remove in the next minor; document the removal in the CHANGELOG.

Post-1.0, a deprecation-then-removal cycle crosses a major version.

## Auth

**Read auth: open, forever. No API key for reads.**

Future write auth (Phase 2):
- **SIWE (Sign-In With Ethereum)** as primary
- Then **Discord**, **GitHub**, **Farcaster**, **passkeys / magic links**
- **No Google.** Ever.

## Payload caps

**1MB on `/filter`.** Zod-enforced via `FilterRequest`. Most translation pipelines hit much less than this; the cap exists to prevent worker DoS via giant payloads. (Initially set to 100KB; raised to 1MB after a real translation source file exceeded the lower cap.)

## Caching

Aggressive on reads, none on writes:

- `/api/v1/info` -- 1 hour
- `/api/v1/style-guide/*` -- 1 day + 7-day stale-while-revalidate
- `/api/v1/languages` -- 1 day
- `/api/v1/translations/*` -- 1 day + 7-day stale-while-revalidate
- `/api/v1/schema` -- 7 days
- `/api/v1/filter` -- `no-store`

Reasoning: the glossary changes weekly at most. Aggressive caching keeps origin load low and the experience fast.

## Domains

**No domain hardcoded anywhere.**

The OpenAPI spec self-derives `servers` from the request origin (see `src/index.ts`). The README explicitly says "consumers should not hardcode any domain."

The repo lives at `github.com/ethereum/ethglossary` and the site at `https://glossary.ethereum.org`; the code learns neither. The host comes from the request and the scheme from the proxy's `X-Forwarded-Proto` (see `src/lib/request-origin.ts`), so a change of host needs no code change.

## License

**MPL-2.0** (Mozilla Public License 2.0). Weak copyleft -- modifications to MPL files must be MPL, but the license does not "infect" the broader project. Compatible with typical commercial use.

Do not change the license without explicit ask. Do not add a CLA. Do not relicense to a more permissive license; the weak copyleft is intentional.

## Translation policy

**v1 locked on 2026-05-10.** Captured in `docs/translation-policy.md`.

The policy was synthesized from pre-existing ethereum.org translation pipeline guidance and validated by two parallel Gemini 3.1 Pro analyses with explicit disagreement resolution. The v1 lock means:

- The five resolved disagreements (Bengali numerals, ja/ko UI tags, ru/uk brands, Tamil prose, zh-tw style) are not up for re-debate without new evidence.
- The 11-value term-role taxonomy and 6-value `script_rule` enum are the target shape.
- Downstream consumers can rely on these conventions.

Native-speaker review for several confidence-medium decisions is queued but not yet done (see policy §9.2). When native speakers become available, those are the first review tasks -- they do not invalidate the v1 lock.

## UI components

**No component library. shadcn's token convention, not its components.**

The semantic token layer in `src/ui/app.css` follows shadcn's naming --
`background` / `foreground` pairs, `card`, `muted`, `secondary`, `accent`,
`primary`, `border`, `input`, `sidebar`. That half is deliberate and worth
keeping: it is a well-worn vocabulary and it stops tokens being named after
the one element they happen to be used on.

shadcn's *components* are React. They are copy-in source built on Radix
primitives, and there is no vanilla or hono/jsx distribution. Adopting them
means adding React, react-dom, a hydration entry point and a client bundler to
a site that currently ships **~2.5 KB of gzipped JavaScript in total**.
react-dom alone is 43 KB gzipped -- roughly nineteen times the entire client
payload -- before any Radix primitive or the component itself.

What earns most of the benefit at none of the cost is the platform:

- The mobile drawer is a `<dialog>` opened with `showModal()`. The browser
  supplies the focus trap, inerts the page behind it, closes on Escape,
  restores focus to the trigger, and renders the backdrop. Its close button is
  a `<form method="dialog">` and needs no script at all.
- Its transition is `@starting-style` plus `transition-behavior: allow-discrete`,
  which is what an animation library would be wrapping anyway.
- The click-to-explain popovers are one shared 4 KB island, because a native
  `title` never fires on touch.

Revisit this only if the app grows genuinely stateful client UI -- a
multi-step suggestion form, live vote counts, optimistic updates. Reaching for
React to get one drawer is the trade to refuse. If it is revisited, the
question is React-plus-shadcn versus a framework-agnostic headless library
(Zag.js has a vanilla adapter), not shadcn versus hand-rolled.
## Code is not translated

**There is no `code` translation context, and there should not be one.**

The slot existed and was populated for all 24 languages before being removed.
It did not survive contact with its own data:

- It varied by language in **345 of 523 terms (66%)**, despite being documented
  as "almost always the English original, because translating it would break
  the thing it names".
- It was the `id` slug with different casing in **486 of 523 (93%)**.
- Every language mixed **five to seven** casing conventions, and the same term
  drew different ones in different languages -- `accountAbstraction` in 19,
  `account_abstraction` in 4, `account-abstraction` in 1. Language has nothing
  to do with casing, so that is 24 translators guessing independently.
- Several languages translated the identifier outright -- `dompet_dingin`,
  `zimny_portfel`, `signatureNumerique` -- which is precisely what the slot's
  own rule forbade.
- Person names got a `code` form containing a space (`Vitalik Buterin`), which
  is not an identifier in any language.

The reason it could not work: **identifier casing is a property of the codebase
and the position, not of the term.** `gas price` is `gasPrice` in Solidity,
`gas_price` in Python, `GAS_PRICE` as a constant, `gas-price` as a CLI flag. A
glossary cannot know which, so asking a translator to pick one produces noise.

### What replaces it

Nothing needed to. Both sides of the integration already excluded code
structurally, and neither ever read the slot:

- `POST /api/v1/filter` strips fenced blocks and inline code before matching
  (`src/lib/content-filter.ts`), so a term in backticks is never returned.
- The ethereum.org intl-pipeline extracts fenced blocks to placeholders before
  the content reaches a model and restores them verbatim, and marks inline code
  `translatable: false`.
- Code **comments** are the exception on both sides: prose that happens to sit
  inside a block, extracted and translated as prose, then restored.
- Where a term must stay Latin in running prose, that is `script_rule:
  always_latin` / `keep_latin` -- decided once per term, authoritatively.

`docs/translation-policy.md` already relied on the same principle for Bengali
and Urdu numerals: "the pipeline uses markdown structure (code fences, inline
backticks, JSX attributes) for boundary detection".

### Removal

Removed outright rather than deprecated-then-removed. The field appeared in one
response only (`GET /api/v1/translations/{lang}/{termId}`), pre-1.0, and the one
known consumer never read any context slot -- a search for `contexts` across the
whole intl-pipeline returns a single hit, an English word in a comment. Keeping
523 x 24 arbitrary values served only to invite someone to consume them.

## "Do not relitigate" list

If you find yourself proposing one of these, stop and ask:

- Switching stacks (Next.js, NestJS, FastAPI, etc.)
- Adding React or a component library to get one interactive widget
- Reintroducing a per-term `code` translation form
- Moving to a database for read data
- Adding Google, OpenAI, Amazon, or Microsoft dependencies
- Removing the `/api/v1/` prefix
- Adding telemetry or analytics
- Hardcoding a domain
- Adding a CLA
- Relicensing
- Re-debating any of the five resolved policy disagreements

If new evidence genuinely warrants reconsideration, present it to the user. Do not silently change.
