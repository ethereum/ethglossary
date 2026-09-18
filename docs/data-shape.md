# Data shape reference

Load this when adding or editing glossary terms, touching the `script_rule` / `category` / `casing` fields, or refactoring the schema.

## Important: three sources of truth currently disagree

There are three places that describe what a glossary entry "looks like" and they are not aligned. Be explicit about which one you are working with:

1. **The bundled data** -- `src/data/glossary-terms-enhanced.json`. This is the runtime truth. The library reads `data.confirmed_terms` only.
2. **The JSON Schema** -- `src/data/glossary-schema.json`. This describes a more elaborate, aspirational shape (`entries` keyed by slug, `en` nested, per-entry `translations` block). The runtime does **not** validate against this schema. Treat the schema as a design document, not as a constraint on current data.
3. **The v1 translation policy** -- `docs/translation-policy.md`. This sets the target shape for `script_rule` and `category` going forward.

When the three disagree, the bundled data is what works at runtime, the policy is what should work next, and the schema is a separate concern that should be reconciled in the migration.

## Bundled data top-level shape

`src/data/glossary-terms-enhanced.json`:

```json
{
  "metadata": { "generated": "...", "total_confirmed": 532, ... },
  "confirmed_terms": { "<canonical term name>": { GlossaryTerm }, ... },
  "term_families": { ... },
  "morphological_families": { ... }
}
```

The runtime (`src/lib/glossary-data.ts`) reads `data.confirmed_terms` only. The other top-level fields are metadata for tooling and are not exposed via the API today.

## `GlossaryTerm` (as it appears in the bundled data)

TypeScript shape from `src/lib/glossary-data.ts`:

```typescript
{
  id: string,                      // kebab-case slug, e.g. "zk-proof". NOT the master key.
  uid: string,                     // 10 chars [0-9a-z], minted once, never changes; feedback/history key
  term: string,                    // canonical form, e.g. "zero-knowledge proof"
  category: string,                // currently topical (see "Categories" below)
  definition: string,              // plain prose; never contains markup links
  references?: Array<{ label: string, url: string }>,   // optional further reading
  has_tooltip: boolean,
  in_glossary: boolean,
  content_occurrences: number,
  forms: { base: string },
  script_rule: string,             // see "script_rule" below
  casing: string,                  // "standard" | "proper" | "uppercase" | "fixed"
  aliases?: Array<string | { term: string, status: string, note?: string }>,
  avoid?: string[],
  note?: string,
  translation_note?: string
}
```

The **master key** in `confirmed_terms` is the canonical term name (e.g. `"proxy contract"`), not the `id` field. This is the single most-common source of confusion in the repo.

## `TranslationEntry` (per language file)

`src/data/translations/glossary-{lang}.json` is keyed by canonical term name (matches the master key, not the slug `id`). Each entry:

```typescript
{
  term: string,                    // primary translated form
  contexts?: {
    prose?: { term: string; example?: string },
    heading?: { term: string },
    tag?: { term: string },
    ui?: { term: string }
  },
  // There is deliberately no `code` context. Code is excluded structurally,
  // not term by term -- see "Code is not translated" in docs/design-decisions.md.

  plurals?: {
    one: string | null,
    two?: string | null,
    few?: string | null,
    many?: string | null,
    other: string | null
  },
  grammar?: {
    gender?: string,
    part_of_speech?: string,
    formality?: string
  },
  confidence?: "high" | "medium" | "low",   // optional; runtime defaults to "high"
  notes?: string
}
```

Plurals follow Unicode CLDR categories. Not every language uses every category.

## `definition` and `references`

`definition` is prose. It **never contains markup links.** It may still carry
light structural HTML (`<br />`, `<strong>`, `<ul>`/`<li>`, `<sup>`, `<em>`),
but an `<a>` tag in a definition is a data bug.

Further reading lives in the optional `references` array instead:

```json
"references": [
  { "label": "Gas and fees", "url": "https://ethereum.org/gas/" }
]
```

- `url` is absolute. ethereum.org targets are prefixed `https://ethereum.org`;
  off-site targets keep their own host. Fragments are preserved.
- `label` is a short noun phrase, sentence-cased, with no "More on " /
  "Learn more about " lead-in.
- Entries are unique by URL and ordered as they appeared in the source prose.
- The field is **omitted entirely** when a term has no references. Never emit
  `"references": []`.

Glossary cross-references (links to other terms) are deliberately *not*
references. They were inline vocabulary, so their text stays in the definition
and the link is dropped -- the consumer already has the whole term list and can
re-link whatever it wants.

## `casing` semantics

Four values; the bundled data uses all four.

- **`standard`** -- normal common-noun rules: capitalize at sentence start, otherwise lowercase. Examples: `ether`, `smart contract`, `onchain`.
- **`proper`** -- always capitalized. Examples: `Ethereum`, `Solidity`.
- **`uppercase`** -- always all-caps. Examples: ticker symbols, `EVM`, `NFT`.
- **`fixed`** -- capitalization is fixed exactly as the `term` field shows; never alter. Examples: `The Merge`, `proof-of-authority`, `MetaMask`, `ethereum.org`, `zkEVM`.

## `script_rule` reconciliation

The three sources disagree on the enum. Be deliberate about which set you are working with.

| Value                            | In schema | In bundled data | In v1 policy | Notes                                                                                       |
|----------------------------------|:---------:|:---------------:|:------------:|---------------------------------------------------------------------------------------------|
| `translate`                      | yes       | yes             | yes          | Render in target-language semantics                                                          |
| `transliterate`                  | yes       | yes             | yes          | Phonetic rendering in target script                                                          |
| `keep_latin`                     | yes       | yes             | yes          | Editorial choice to keep Latin for branding or clarity                                       |
| `always_latin`                   | NO        | yes             | yes          | Translation would break code/spec/identification (Solidity, ETH, ERC-20, file extensions)    |
| `calque`                         | NO        | no              | yes          | Semantic translation for CJK semantic group (e.g. "smart contract" -> 智能合约 zh)            |
| `transliterate_with_translation` | NO        | no              | yes          | Latin form plus a native-script gloss (e.g. "MetaMask 钱包" zh)                              |
| `hybrid`                         | yes       | yes             | NO           | Removed by v1 policy. Terms previously `hybrid` should be split into multiple entries.       |
| `context_dependent`              | yes       | yes             | NO           | Removed by v1 policy. Same rationale as `hybrid`.                                            |

**Migration sketch:**

- Add `calque` and `transliterate_with_translation` to the data enum and to the schema enum.
- For each entry currently using `hybrid` or `context_dependent`, split into multiple entries with distinct IDs (e.g. `gas_concept` vs `gas_limit_variable`) per v1 policy §5.
- Update `glossary-schema.json` to match the bundled data enum, then evolve toward the v1 policy.

Do not silently flip values during unrelated work. Each `script_rule` change is a real policy decision per term.

## `category` reconciliation

The current data uses **topical** categories (15 values):

```
accounts-keys, consensus, cryptography, defi, development, ether, general,
governance, identity, mev, protocol-upgrades, scaling, smart-contracts,
tokens, transactions
```

The v1 policy uses `category` as **term role** (11 values):

```
concept, brand-or-project, person-name, programming-language, os-platform,
cryptographic-primitive, network-name, file-extension, cli-command,
ticker-or-standard, identifier
```

These are two different axes. Options for reconciliation (an open design call, not yet decided):

- **Replace `category`** with term role -- aligns with policy but loses topical filtering used by the viewer.
- **Add a new `term_role` field** alongside `category` -- preserves both axes, larger data change.
- **Rename `category` to `topic`** and add `term_role` -- cleanest but biggest churn.

Recommended for any future PR: add `term_role` as a new optional field; defer renaming `category` until the consumer side (viewer, OpenAPI clients) has been audited.

## Aliases

Always normalize -- both object and bare-string forms appear in the data:

```typescript
const aliasStr = typeof a === "string" ? a : a.term
```

Object form: `{ term, status: "preferred" | "accepted" | "deprecated", note?: string }`.

Status semantics: `preferred` = currently recommended; `accepted` = recognized but not preferred; `deprecated` = recognized but actively discouraged for new content (some legacy entries use `deprecated` while others put the term in `avoid` -- inconsistency to clean up later).

## `avoid` list

Lowercase or otherwise-incorrect forms that users should not use in new content (e.g. `on-chain`, `Layer 2`, `DApp`). The surface-form index includes these so that lookup with `/api/v1/style-guide/on-chain` resolves to the canonical `onchain` entry.

## `forms.base`

Lowercase, hyphen-free, no-affix base form used for surface-form matching. Example: term `"proof-of-stake"`, `forms.base = "proof of stake"`. This is what the content-filter regex matches against, so getting it right matters for the `/filter` endpoint.

## JSON Schema (`src/data/glossary-schema.json`)

The schema is **aspirational** and does not match the bundled data exactly. Key differences:

- Schema uses `entries` keyed by slug ID with nested `en` and `translations` fields. Bundled data uses `confirmed_terms` keyed by canonical term name with translations in separate per-language files.
- Schema declares richer fields not in current data: `tier`, `deprecated`, `related`, `term_family`, `transliteration` (per-language), `script_override` (per-language), `source`, `reviewed_by`, `updated`, `aliases` (per-translation), `forms` (POS-based morphology per translation), `glossary_ref`, `translation_context`, `usage_note`.
- Schema `script_rule` enum: `keep_latin, translate, transliterate, hybrid, context_dependent`. Missing the `always_latin` value that the bundled data actually uses.

When the schema and data disagree, **the data is the runtime truth.** Schema reconciliation is a separate migration task.
