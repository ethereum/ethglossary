# AGENTS.md -- ETHGlossary

Conventions for any agent (Claude Code, GitHub Copilot, Cursor, OpenAI Codex, others) working in this repo.

## What this repo is

ETHGlossary is a standalone API and HTML viewer for canonical Ethereum terminology, served from a container on Ethereum Foundation infrastructure at `https://glossary.ethereum.org`. Three consumers:

- Humans browsing the viewer at `/`
- LLMs and tooling consuming `/openapi.json` and `/llms.txt`
- Translation pipelines POSTing source content to `/api/v1/filter` to get matching terms back.

Two product surfaces:

- **English style guide** -- 521 terms with casing rules, avoid lists, aliases, editorial notes. Authoritative for "what is the right way to write `<term>`?"
- **Translation reference** -- 24 languages with contextual forms (prose, heading, tag, UI), plurals, grammar, confidence levels, and a v1-locked transliteration policy covering 13 non-Latin-script languages.

Live deployment: `https://glossary.ethereum.org`. The repo is `github.com/ethereum/ethglossary`. Consumers should call the URL, not the GitHub path.

## Stack

- **Hono** `^4.12.x` -- edge-deployable web framework
- **@hono/zod-openapi** `^1.3.x` -- routes defined with Zod; OpenAPI 3.1 auto-generated
- **@scalar/hono-api-reference** -- interactive docs at `/docs`
- **Node 22** -- `src/server.ts` on `@hono/node-server`, bundled into one file by esbuild (`scripts/build-server.mjs`). The same program runs in `pnpm dev` and in the container
- **Container image** built by `.github/workflows/docker.yml` on every push to `main` and rolled out on EF infrastructure by devops (`Dockerfile`)
- **TypeScript 5.x**, ESM; esbuild bundles the server, Tailwind compiles the stylesheet

Auto-generated OpenAPI from the same Zod schemas used for runtime validation is a real win. Do not migrate to Next.js or another framework without strong reason. See `docs/design-decisions.md` if tempted.

## Repository layout

```
.
├── AGENTS.md                       # this file
├── README.md
├── LICENSE                          # MPL-2.0
├── package.json
├── pnpm-workspace.yaml              # empty -- isolates from any parent workspace
├── tsconfig.json                    # resolveJsonModule: true (we import .json)
├── Dockerfile                       # production image: node dist/server.js
├── docker-compose.yml               # local Postgres for development (pnpm run db:up)
├── migrations/                      # Postgres schema, append-only .sql; see "Database"
├── .github/workflows/docker.yml     # builds and publishes the image on push to main
├── docs/
│   ├── api-spec.md                  # internal planning spec
│   ├── data-shape.md                # GlossaryTerm / TranslationEntry shapes; script_rule reconciliation
│   ├── design-decisions.md          # settled decisions; do-not-relitigate list
│   ├── gotchas.md                   # full annotated gotchas
│   ├── translation-policy.md        # v1-locked translation policy
│   └── term-template.json           # template for a new GlossaryTerm
├── scripts/
│   ├── audit-glossary.mjs           # audit data vs v1 policy; outputs Markdown
│   ├── build-server.mjs             # esbuild: src/server.ts -> dist/server.js
│   ├── term-uid.mjs                 # mint / backfill / check the stable term uid
│   ├── dev.mjs                      # esbuild watch + node --watch, loads .env.local
│   └── verify-deploy.sh             # smoke test for a running deploy
└── src/
    ├── index.ts                     # the app: CORS, cache headers, OpenAPI doc, Scalar, viewer mount
    ├── server.ts                    # Node entry: static files, /healthz, db + migrations, listen, SIGTERM
    ├── db/
    │   ├── client.ts                # the postgres pool; getDb() is null without DATABASE_URL
    │   └── migrate.ts               # applies migrations/*.sql at startup under an advisory lock
    ├── llms.txt                     # served at /llms.txt
    ├── data/
    │   ├── glossary-terms-enhanced.json   # master English term data (532 terms)
    │   ├── glossary-schema.json           # JSON Schema (aspirational, not 1:1 with data)
    │   └── translations/
    │       └── glossary-{lang}.json       # 24 files
    ├── lib/
    │   ├── glossary-data.ts         # JSON loading; surface-form index; resolveTerm
    │   ├── content-filter.ts        # filterForContent
    │   ├── hash.ts                  # slotHash / termHash -- what feedback is anchored to
    │   ├── indexer.ts               # startup: records what a deploy changed (term_changes)
    │   ├── context-types.ts         # the six votable translation slots; applicableContexts()
    │   ├── language-meta.ts         # endonyms, regions, script direction (viewer only)
    │   └── sanitize.ts              # HTML allowlist for definitions
    ├── ui/                          # server-rendered hono/jsx viewer
    │   ├── app.css                  # Tailwind v4 source: @theme tokens + utilities
    │   ├── fonts.css                # GENERATED -- pnpm run build:fonts
    │   ├── layout.tsx               # page shell, nav, footer, theme script
    │   ├── icon.tsx                 # <Icon name> -- Lucide imports + custom art
    │   ├── icons/                   # custom .svg only (brand marks); Lucide comes from npm
    │   ├── islands.ts               # client scripts (search, language picker)
    │   └── pages/                   # home, translate, contexts, languages, style-guide
    ├── schemas/                     # Zod schemas (common, style-guide, translations, filter)
    └── routes/                      # info, style-guide, translations, filter, schema, viewer
```

All API endpoints live under `/api/v1/`. Root paths: `/` (viewer), `/docs` (Scalar), `/openapi.json`, `/llms.txt`.

## Endpoint summary

| Method | Path                                     | Purpose                                                  |
|--------|------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/info`                           | Term count, language count, supported codes              |
| GET    | `/api/v1/style-guide`                    | Full English style guide; `?category=` filter            |
| GET    | `/api/v1/style-guide/search?q=`          | Fuzzy search across term/alias/avoid/definition          |
| GET    | `/api/v1/style-guide/{termId}`           | Single term with intelligent resolution                  |
| GET    | `/api/v1/languages`                      | Supported languages with completion stats                |
| GET    | `/api/v1/translations/{lang}`            | Full glossary for one language                           |
| GET    | `/api/v1/translations/{lang}/{termId}`   | Single term translation plus English source              |
| POST   | `/api/v1/filter`                         | Submit text (max 1MB), receive matching terms            |
| GET    | `/api/v1/schema`                         | Raw JSON Schema for the glossary data                    |
| GET    | `/llms.txt`                              | LLM-friendly description                                 |
| GET    | `/openapi.json`                          | Auto-generated OpenAPI 3.1 spec                          |
| GET    | `/docs`                                  | Scalar interactive API docs                              |
| GET    | `/`                                      | HTML viewer (beta)                                       |

For exact request/response shapes use `/openapi.json` as the source of truth.

### Intelligent term resolution

`/style-guide/{termId}` and `/translations/{lang}/{termId}` resolve via a surface-form index built at module load. Lookup order:

1. Canonical term name (case-insensitive)
2. `forms.base`
3. Aliases (string or object form)
4. Avoid-list entries (so `on-chain` resolves to `onchain`)

Misses return 404 with a `suggestions` array.

## Top gotchas -- read before touching data

Full annotated list in `docs/gotchas.md`. Highest-impact items:

1. **Translation files are keyed by canonical term name, NOT by `id` slug.** Master `confirmed_terms` key = `"proxy contract"`. Translation file key = `"proxy contract"`. Term `id` = `"proxy-contract"`. When joining master and translations, use `Object.keys(getTerms())`, never `t.id`. A production bug from mixing these once reported every language as ~60% complete.

2. **Three different `script_rule` value sets currently coexist.** The JSON Schema enum (v1-aligned: 6 values), the bundled data (6 values including legacy `hybrid`/`context_dependent` until they are migrated), and the v1 translation policy target (6 values). Before touching `script_rule`, load `docs/data-shape.md` for the reconciliation table.

3. **`category` is currently topical** (`scaling`, `defi`, `consensus`, etc., 15 values) but the v1 translation policy uses `category` as **term role** (`concept`, `brand-or-project`, etc., 11 values). Migration is in progress; do not silently switch.

4. **Aliases can be strings OR objects.** Most are `{ term, status, note? }`; some legacy entries are bare strings. Always normalize:
   ```typescript
   const aliasStr = typeof a === "string" ? a : a.term
   ```

5. **Translation files have 9 orphan entries.** Files contain 541 entries; master has 532. The orphans are morphological variants, DRY pattern members and abbreviations -- deliberate, not stale. Filter at the API layer (already done in `routes/translations.ts`). Do not assume key-set parity. See `docs/gotchas.md` section 5.

6. **Confidence is optional in data; runtime defaults to `"high"`.** Default to `"high"` when reading directly from JSON or types break.

7. **OpenAPI server URL is derived at request time.** Do not hardcode any domain in the spec.

8. **Worktree hazards.** If this codebase is a worktree of a parent monorepo: do NOT run `git remote remove origin` -- it touches the parent. Use `--ignore-workspace` or rely on the empty `pnpm-workspace.yaml` for `pnpm install`.

## Working preferences -- non-negotiable

These come from the repo owner. They are not negotiable. The reasoning matters because it lets you handle edge cases.

### Permission is single-use, never in perpetuity

"Go ahead and commit" authorizes ONE commit. "Push it" authorizes ONE push. "Deploy" authorizes ONE deploy. Do not chain operations. Do not assume that approval for an earlier change extends to the next change. Combining operations has cost trust in the past.

### Commit and push are separate steps

Always commit first, show the result, wait for explicit go-ahead, then push.

### Never auto-commit

"Make this change" / "fix this bug" / "add this feature" is NOT permission to commit. Edit the files. Show the diff. Wait.

### Plain ASCII commit messages

No em dashes, smart quotes, fancy hyphens, or Unicode in commit messages. Use `--` for ranges if needed. Straight quotes only.

### Commit subject conventions

- Maximum 50 characters
- Lowercase
- Verb-prefix, imperative
- Allowed prefixes: `add:` (new feature), `fix:` (bug fix), `refactor:` (no behavior change), `docs:`, `chore:`, `test:`

The body explains WHY, not WHAT. The diff already shows what changed.

### Co-author lines

Every commit ends with two co-author lines:

```
Co-Authored-By: Claude <model-name> <noreply@anthropic.com>
Co-Authored-By: wackerow <54227730+wackerow@users.noreply.github.com>
```

Do NOT add version variants in the Claude line ("1M context", etc.) -- the user considers it unnecessary noise.

### Short responses by default

State results and decisions directly. Skip self-narration. Long replies only when warranted.

### Disclaim confidence honestly

"I am moderately confident" / "I have not verified X" / "I think this works but have not tested it" are welcome. False certainty is not.

### No "you're absolutely right" or apologies

Patronizing. Engage with substance. If correct, acknowledge specifically. If incorrect, push back. No social-ritual apologies; just state the mistake and the fix.

### Open-source / privacy / ethics priorities

In priority order:

- Avoid Google products and Google-touched dependencies entirely.
- Avoid OpenAI and Amazon equally.
- Avoid technologies that further empower already-wealthy/powerful entities.
- Prioritize FLOSS / open-source tooling.
- Prioritize privacy and individual freedom.
- Hosting is Ethereum Foundation infrastructure run by devops. No third-party hosting accounts.

No telemetry / analytics may be added without explicit ask.

## Commit message template

```
<prefix>: <imperative subject, under 50 chars, lowercase, ASCII only>

<optional body explaining WHY, wrapped at ~72 chars. Skip if subject is enough.>

Co-Authored-By: Claude <model-name> <noreply@anthropic.com>
Co-Authored-By: wackerow <54227730+wackerow@users.noreply.github.com>
```

## The viewer

The human-facing site is server-rendered with `hono/jsx` under `src/ui/`,
mounted by `src/routes/viewer.tsx`. Styling is **Tailwind v4**, compiled from
`src/ui/app.css`. There is no client framework; interactivity is three
vanilla-JS islands -- `src/ui/islands.ts` (term filtering), `src/ui/tooltip.ts`
(click-to-explain popovers) and `src/ui/nav-drawer.ts` (the mobile menu).
Every script the site ships totals about 2.5 KB gzipped.

Rules that are easy to get wrong:

- **Never link an external font host.** Fonts are self-hosted woff2 subsets
  under `public/fonts`, generated by `scripts/build-fonts.mjs`. Every face
  carries a `unicode-range`, so a page downloads only the scripts it renders.
  CJK is the one exception and is deliberately NOT self-hosted -- see the
  `--font-cjk` comment in `app.css`.
- **Use the theme scale, not arbitrary values.** `@theme` in `app.css` names
  every color and text size after the thing it is in Figma -- `text-h1`,
  `text-label-md`. Reach for `text-[19px]` only when the design genuinely has
  no token for it. Prefer a standard Tailwind token over a custom one:
  `max-w-3xl`, never `max-w-[555px]`.
- **`@theme` has two layers, and only the first holds a hex.** The palette
  layer is scale-named and never themed (`--color-yellow-400`,
  `--color-plum-700`). The semantic layer names roles, and every themed value
  is a single `light-dark()` pair (`--color-background`, `--color-foreground`,
  `--color-border`). Add a role, not a hex, and never name a token after the
  one element it is used on.
- **`light-dark()` resolves against `color-scheme`,** which is why the two
  blocks at the bottom of `app.css` set `color-scheme` rather than redefining
  colors: `@media (prefers-color-scheme: light)` guarded with
  `:root:not([data-theme="dark"])`, and `:root[data-theme="light"]` for the
  explicit toggle. Do NOT add `dark:` variants. `light-theme:` is a
  `@custom-variant` for the rare case that needs to branch on markup rather
  than color.
- **`--color-primary` is a fill, `--color-accent` is for text.** The brand
  yellow measures 1.21:1 on the light ground. `accent` swaps to a same-hue
  darker step there; `primary` stays yellow because it always sits behind
  dark text.
- **The Scalar bundle on `/docs` is pinned, path and all.** Its default CDN
  URL 302s to `@latest`, which means a third-party script with an LLM feature
  attached changes under the deployed site with no commit here. `SCALAR_CDN`
  in `src/index.ts` names the exact file; bumping it is a deliberate act.
- **URLs to Discord, GitHub, X, Farcaster or ethereum.org come from
  `src/lib/constants.ts`.** Never inline them. ETHGlossary has no social
  accounts of its own -- X and Farcaster point at ethereum.org's.
- **Never hardcode the site's own origin.** Canonical links, `og:*` URLs,
  `robots.txt`, `sitemap.xml` and the OpenAPI `servers` entry all take it
  from the request through `requestOrigin()` in `src/lib/request-origin.ts`,
  which reads the scheme from the proxy's `X-Forwarded-Proto` and the host
  from the request. Never read `new URL(c.req.url).origin` directly: behind
  the TLS-terminating proxy it says `http://`.
- **External links go through `<ExternalLink>`** in `src/ui/link.tsx`, which
  adds `target="_blank"`, the `rel` pair, and Lucide's external-link marker.
  Pass `hideArrow` for icon-only links, and always give those an `aria-label`.
- **Term URLs are built from `id`, and `id` is indexed separately.**
  `resolveTerm()` indexes the canonical key, `forms.base`, aliases and avoid
  forms -- plus the `id` slug in a final pass. That last pass is what makes
  the 200-of-532 terms whose id differs from their key reachable at all.
- **Icons are Lucide imports at the call site.** `import thumbsUp from
  "lucide-static/icons/thumbs-up.svg"`, then `<Icon svg={thumbsUp} />`. The
  esbuild text loader resolves the import to source text, so there is no
  registry to update and nothing to copy into the repo. `src/ui/icons/` is
  for custom art only -- today the brand marks Lucide does not ship.
- **A table row with one link is clickable end to end.** Put `data-row-link`
  on the `<tr>` (plus `group cursor-pointer`) and let `src/ui/row-link.ts`
  widen the hit area; the `<a>` itself is untouched, so keyboard and screen
  reader behaviour is exactly the link's. Two things NOT to do: an `<a>` in
  every `<td>` with `aria-hidden` on the duplicates works for a mouse and
  hides the cells' content from a screen reader; and a stretched `::after`
  over a `position: relative` row is silently ignored by WebKit when the
  table is `border-collapse: collapse`, which lets the overlay escape to the
  initial containing block and swallow taps across the whole page.
- **Reach for the platform before writing behavior.** The mobile drawer is a
  `<dialog>` opened with `showModal()`, so the focus trap, page inertness,
  Escape, focus restoration and the backdrop are the browser's, and its
  transition is `@starting-style` plus `allow-discrete` rather than a
  animation library. The token layer follows shadcn's naming convention, but
  shadcn's components are React and this site has no client framework -- see
  `docs/design-decisions.md`.
- **A gated control is `aria-disabled`, never `disabled`.** A disabled element
  fires no click event, so it cannot explain why it is inert. Give it
  `data-tip` (plus `readonly` on a field) and `src/ui/tooltip.ts` shows the
  reason on click -- which is the only thing that works on touch, where
  `title` never fires.
- **Definitions carry HTML.** Run them through `sanitizeDefinition()` from
  `src/lib/sanitize.ts` -- stripping tags produces run-on sentences, and
  community-submitted content will flow through the same components later.
- **Slot counts vary.** Use `applicableContexts()` from
  `src/lib/context-types.ts`; never hardcode six. See `docs/context-types.md`.

### Viewer routes

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/style-guide` | Every English term, filterable client-side |
| `/style-guide/:termId` | One term: definition, casing, and its prose form in all 24 languages |
| `/translations` | The picker: coverage per language, plus an "All languages" row |
| `/translations/all` | All languages at once. A term picker; nothing here is votable |
| `/translations/all/:termId` | One term across 24 languages x every applicable context |
| `/translations/:lang` | One language: the contributor view |
| `/translations/:lang/:termId` | One term in one language, with the vote controls |
| `/translations/change` | Clears the stored language and returns to the picker |
| `/contexts` | What prose / heading / tag / ui / code / plurals mean |
| `/robots.txt`, `/sitemap.xml` | Crawler surface. Everything is allowed |

Rules that are not obvious from the table:

- **`/languages` and `/translate/*` are gone.** Picking a language and
  reviewing one were two tabs pointing at one task. They 301 to their
  `/translations` equivalents, from the `MOVED` table at the bottom of
  `viewer.tsx`, which is registered after the real routes so it can never
  shadow one. Do not reintroduce the old paths.
- **`/translations` does not redirect.** The nav is what routes a reader with
  a stored language straight to `/translations/:lang` -- see `navHref()` in
  `layout.tsx`.
- **Feedback is always cast against one language.** `/translations/all` is
  read-only by construction and says so on the page. Do not add vote controls
  to it.

## Database

Community feedback lives in a PostgreSQL database. In production devops run
it and hand the app a `DATABASE_URL`; locally `pnpm run db:up` starts one in
Docker that the `DATABASE_URL` in `.env.example` points at. The glossary
itself stays in the bundled JSON; the database never changes what the site or
API serves.

- **`DATABASE_URL` is optional.** Without it, or if the database cannot be
  reached at startup, the app logs that and serves the read-only glossary
  exactly as before. The glossary API is the critical path; feedback is not.
- **Schema** is `migrations/NNNN_label.sql`, append-only. Never edit a file
  that has shipped; add the next number. `src/db/migrate.ts` applies pending
  files at startup, before the server listens, under an advisory lock so
  replicas do not race. Nothing to run by hand, in any environment.
- **Every master entry has a `uid`** (`scripts/term-uid.mjs`). Feedback and
  history key on it, never on the canonical name or the `id` slug, because
  both of those change on rename. `pnpm run check:uids` verifies the data.
- **Feedback is anchored to content hashes.** `slotHash` / `termHash` in
  `src/lib/hash.ts` hash the exact value a reviewer saw; whether feedback is
  about the live value is decided by re-hashing the bundled data at request
  time, never by reading a table.
- **`src/lib/indexer.ts` runs once at startup** and records what this build
  changed against the previous one, keyed on `GIT_SHA` (a content hash in
  development). It is the only writer of `glossary_snapshots`, `entry_state`,
  `term_state` and `term_changes`. The first run records state and emits no
  change rows.
- **Look at the data** locally with `pnpm run db:psql`, or `pnpm run db:ui`
  for pgweb at `http://127.0.0.1:8081` (read-only; tunnel the port over SSH
  like the dev server). Production access is through devops.
- **Portability:** plain SQL, application-minted UUIDs, no extensions.

## Adding a glossary term

Read `docs/data-shape.md` and `docs/term-template.json` first. Then:

1. Decide the canonical term name (becomes the JSON key in `confirmed_terms`) and a stable kebab-case `id`. Mint a `uid` with `node scripts/term-uid.mjs`; it is never edited afterwards.
2. Pick `casing` (`standard` / `proper` / `uppercase` / `fixed`) -- see `docs/data-shape.md` for the semantics.
3. Pick `script_rule`. If the term is a brand, project, person, programming language, OS, ticker, etc., consult `docs/translation-policy.md` §4 to choose the right value based on term role.
4. Add to `src/data/glossary-terms-enhanced.json` under `confirmed_terms` using the template.
5. Add per-language translation stubs under `src/data/translations/glossary-{lang}.json` for each of the 24 languages.
6. **Validate**: `npx tsc --noEmit`
7. **Test resolution locally**:
   ```bash
   pnpm dev
   curl http://127.0.0.1:8787/api/v1/style-guide/<termId>
   curl http://127.0.0.1:8787/api/v1/translations/en/<termId>
   curl http://127.0.0.1:8787/api/v1/languages          # confirm stats unchanged
   ```
8. Report results. Wait for single-use permission before commit, then again before push.

## DRY pattern families -- do NOT add per-instance entries

Some identifiers follow a uniform programmatic format with hundreds of instances. **Never add per-instance master entries for these.** The rule is encoded once on the parent entry and `src/lib/content-filter.ts` pattern-matches the family at request time via `STANDARD_PATTERNS`.

Currently handled:

| Family  | Examples                                       | Parent master entry                       |
|---------|------------------------------------------------|-------------------------------------------|
| `ERC-N` | ERC-20, ERC-721, ERC-1155, ERC-4337, ERC-7702 | `ethereum request for comments (erc)`     |
| `EIP-N` | EIP-1559, EIP-4844, EIP-7702                  | `ethereum improvement proposal (eip)`     |

**To add a new family** (e.g. BIP-N, RIP-N, a new EIP/ERC variant):

1. Append a `StandardPattern` entry to `STANDARD_PATTERNS` in `src/lib/content-filter.ts` with the regex, parent term key, and surface-form normalizer.
2. Confirm the parent master entry exists and documents the always-Latin rule in its `note` field.
3. Verify with a `curl` to `/api/v1/filter` containing several instances of the family.

**Single instances that are NOT pattern members** (ETH ticker, BTC, USDC, DAI, individual specific tokens) stay as their own master entries -- they are individual standards, not pattern family members.

**Why this matters:** ERC and EIP each have hundreds of numbered instances. Adding entries per instance is duplicate work that does not scale and breaks the DRY principle. The pattern-matching approach handles every current and future instance with zero data changes.

## Translation and transliteration decisions

For any question about how a term should render in a non-Latin-script language -- script choice, transliteration vs calque, brand handling, numerals, plurals -- load `docs/translation-policy.md`. It is the v1-locked policy (2026-05-10) synthesized from prior linguistic guidance and validated by two parallel Gemini 3.1 Pro analyses with explicit disagreement resolution.

Quick lookup before loading the full policy:

- **Non-Latin scripts in scope:** `ar, bn, hi, ja, ko, mr, ru, ta, te, uk, ur, zh, zh-tw`
- **Latin scripts (transliteration N/A):** `cs, de, es, fr, id, it, pl, pt-br, sw, tr, vi`
- **Term roles** (informs default `script_rule`): `concept`, `brand-or-project`, `person-name`, `programming-language`, `os-platform`, `cryptographic-primitive`, `network-name`, `file-extension`, `cli-command`, `ticker-or-standard`, `identifier`
- **`script_rule` values in the v1 policy**: `translate`, `calque`, `transliterate`, `keep_latin`, `always_latin`, `transliterate_with_translation`
- **Globally `always_latin`** across all 13 non-Latin-script languages: tickers (ETH, BTC), token standards (ERC-20), improvement proposals (EIP-1559), RPC/protocol identifiers, crypto primitives (Keccak256), network parameters with units (32 ETH, 1 Gwei).

## When to consult what

| File                          | Trigger                                                                                  |
|-------------------------------|------------------------------------------------------------------------------------------|
| `docs/data-shape.md`          | Adding/editing terms; touching `script_rule`/`category`/`casing`; refactoring the schema |
| `docs/gotchas.md`             | Before any non-trivial edit to data or API code                                          |
| `docs/translation-policy.md`  | Any translation, transliteration, script-rule, term-role, or per-language question       |
| `docs/design-decisions.md`    | When tempted to introduce a new framework, dependency, or break a v1 convention; for API stability and versioning criteria |
| `docs/api-spec.md`            | When designing or extending API endpoints                                                |
| `docs/common-fixes.md`        | Recipe for a routine fix: dedup, translation update, term add/remove, pattern family add, script_rule fix, typo |
| `/openapi.json`               | Exact request/response shapes (source of truth for the API surface)                      |

## Common workflows

### Local development

```bash
pnpm install                       # uses --ignore-workspace via empty pnpm-workspace.yaml
pnpm dev                           # fonts + css, then esbuild in watch mode, restarting node on 127.0.0.1:8787 after each rebuild
```

**Use `pnpm dev`, not bare `node dist/server.js`.** The stylesheet is a build
artifact; starting the server without building first serves a page with no
CSS at all. The build output IS committed so a fresh clone renders, but it
goes stale the moment you edit a class -- `pnpm dev` keeps it honest. `pnpm
dev` also loads `.env.local` when present (gitignored; copy `.env.example`),
which is where OAuth and database settings live on a development machine.

SSH-tunnel for remote dev (use `127.0.0.1`, not `localhost`):
```bash
ssh -L 8787:127.0.0.1:8787 host
```

### Type check
```bash
pnpm run check     # tsc --noEmit
```

### Build the viewer assets
```bash
pnpm run build          # fonts + css + server bundle (what the Dockerfile runs)
pnpm run build:assets   # fonts + css only (what `pnpm dev` runs before watching)
```

The asset steps are independent of each other:

- `build:fonts` regenerates `src/ui/fonts.css` and repopulates `public/fonts/`
  from the `@fontsource` packages. Fonts are self-hosted -- never link a CDN.
- `build:css` compiles `src/ui/app.css` to `public/assets/app.css` with
  Tailwind. **Editing a class in a `.tsx` requires a rebuild to take effect.**
  The output is committed (so a clone renders without a build) and is left
  unminified on purpose, so the diff is reviewable; the proxy compresses it in
  transit either way. Rebuild and commit it whenever classes change.
- `bundle` runs esbuild over `src/server.ts` into `dist/server.js`, one file
  with every dependency inside. `dist/` is gitignored; the container builds it.

### Audit data against v1 policy
```bash
node scripts/audit-glossary.mjs > /tmp/audit-report.md
```

### Verify a deploy
```bash
scripts/verify-deploy.sh https://glossary.ethereum.org
scripts/verify-deploy.sh http://127.0.0.1:8787
```

### Deploy to production

There is no manual deploy. Every push to `main` builds a container image
through `.github/workflows/docker.yml`, publishes it to
`ghcr.io/ethereum/ethglossary`, and devops' cluster rolls it out within about
five minutes. Verify with `scripts/verify-deploy.sh https://glossary.ethereum.org`
once it lands. There is no wrangler in the repo and no Cloudflare
deployment; do not add either back.

### Push to GitHub

The remote is `origin` = `git@github.com:ethereum/ethglossary.git`. Push a
feature branch and open a pull request; never push to `main` directly, and
never force-push a shared branch.

```bash
git push -u origin <branch>
```

Only push after explicit single-use approval. Never combine commit and push.

## First moves on session start

1. Read this AGENTS.md end-to-end.
2. Run `git status` and `git log --oneline | head` to know where things stand.
3. Never commit, push, or deploy without explicit single-use approval.
4. If asked to do something that touches glossary data, the `script_rule` enum, the `category` field, or translation policy, load the relevant doc before editing.
