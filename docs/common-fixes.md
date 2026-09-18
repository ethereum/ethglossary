# Common fixes

Recipes for routine ETHGlossary cleanup. Each recipe assumes you have already loaded `AGENTS.md` and any referenced docs.

The validation block at the bottom applies to every recipe.

## Dedup two entries

When two master keys describe the same underlying concept (e.g., `byzantium` and `byzantium fork`):

1. Identify the canonical key. Prefer the shorter, more direct form unless the more descriptive form has materially richer data.
2. Compare both entries (`jq '.confirmed_terms["<key>"]' src/data/glossary-terms-enhanced.json` on each) and decide which fields to keep from each. Common decisions: keep the richer `definition`, keep the higher `content_occurrences` (it reflects real usage), merge `aliases`.
3. **Before deleting anything**, inspect the per-language translation files for both keys (`jq '.["<key>"]' src/data/translations/glossary-<lang>.json` for a handful of languages). If the translations are **semantically distinct** (e.g., "Byzantium" -> "Bizancio" vs "Byzantium fork" -> "bifurcación Bizancio"), STOP. These are not duplicates; they are similar surface forms with different meanings. Document the distinction in the entries' `note` fields instead of merging.
4. If the translations are genuinely duplicate or one is clearly superior: merge per-language data into the canonical entry's translation, delete the duplicate from all 24 translation files, and add the duplicate's English form as an `alias` (status: `accepted` or `deprecated` depending on intent) on the canonical master entry.
5. Update `metadata.total_confirmed` in the master data file.
6. Validate (see bottom). Commit with `refactor:` prefix.

## Update a translation

When a per-language translation needs to change:

1. Find the master entry. If you only have the English term, locate it: `jq '.confirmed_terms | keys[] | select(test("<pattern>"))' src/data/glossary-terms-enhanced.json`.
2. Note the **canonical English term name** (the JSON key, e.g., `"proxy contract"`). This is what the translation file is keyed on, NOT the entry's `id` field.
3. Open `src/data/translations/glossary-<lang>.json` and find the entry under that key.
4. Update the relevant field:
   - `term`: the primary/canonical translation.
   - `contexts.prose.term`, `contexts.heading.term`, `contexts.tag.term`, `contexts.ui.term`, `contexts.code.term`: context-specific forms.
   - `plurals.{zero,one,two,few,many,other}`: CLDR plural forms.
   - `aliases`: alternative valid translations.
5. If the change touches multiple `contexts`, update each.
6. Set `confidence` to `"high"` if the change came from an authoritative source; otherwise leave it.
7. Update `notes` if there is rationale worth preserving (e.g., "preferred by content lead per 2026-XX-XX review").
8. Optionally set `updated` to the current ISO date-time.
9. Validate (see bottom). Commit with `fix:` (correction) or `chore:` (refinement without correcting an error).

## Add a new term

See `AGENTS.md` "Adding a glossary term" section. Use `docs/term-template.json` as the starting point. Required fields: `id`, `term`, `category`, `term_role`, `definition`, `casing`, `script_rule`, `forms.base`. Optional: `aliases`, `avoid`, `note`, `translation_note`. Per-language translation stubs in each `src/data/translations/glossary-<lang>.json`.

## Remove a term

When a term is no longer relevant (e.g., a deprecated standard):

1. **Confirm with the maintainer.** Removing a term is potentially breaking if a consumer has been resolving to it.
2. Delete the entry from `src/data/glossary-terms-enhanced.json`.
3. Either delete the corresponding key from all 24 `src/data/translations/glossary-<lang>.json` files (clean), or leave it (becomes orphan; filtered at the API layer).
4. Update `metadata.total_confirmed`.
5. Validate. The audit script should not flag unexpected new orphans.
6. Commit with `chore:` prefix.
7. Flag in the commit body whether this should be considered a breaking change per `docs/design-decisions.md` "Breaking change examples".

## Add a new pattern family (DRY)

When a class of identifiers shares a uniform format with many instances (BIP-N, RIP-N, CIP-N, chain-ID-N, etc.):

1. Verify there are at least ~5 instances of the family in real content. Single instances do not warrant pattern infrastructure; add them as individual master entries.
2. Confirm the parent master entry exists in `src/data/glossary-terms-enhanced.json` (e.g., `bitcoin improvement proposal (bip)`). Create it first if not. The parent should be a `concept`-role entry with `script_rule: translate` and a `note` documenting the always-Latin rule for instances.
3. Open `src/lib/content-filter.ts` and append a `StandardPattern` entry to `STANDARD_PATTERNS`:
   - `family`: short label (e.g., `"BIP"`).
   - `regex`: case-insensitive, word-boundary, capturing the numeric portion. Pattern: `/\b<FAMILY>[-\s]?(\d+)\b/gi`.
   - `parentTermKey`: canonical key for the parent entry.
   - `normalize`: function returning the canonical surface form (typically hyphenated, e.g., `(raw) => `<FAMILY>-${raw.match(/\d+/)![0]}``).
4. Test: `curl -X POST http://127.0.0.1:8787/api/v1/filter` with source content containing several instances of the new family. Confirm each instance returns with `translation === english` and the parent's note attached.
5. Update `AGENTS.md` "DRY pattern families" table to list the new family.
6. Validate. Commit with `add:` prefix.

## Correct a script_rule on existing entries

When entries have wrong `script_rule` values (e.g., tickers marked `keep_latin` should be `always_latin`):

1. Run `node scripts/audit-glossary.mjs --section=script-rule` to see the current distribution and any flagged migration candidates.
2. Determine the correct value per `docs/translation-policy.md` section 4 (term-role defaults) and section 5 (script_rule semantics).
3. Update the entries in `src/data/glossary-terms-enhanced.json`. If multiple entries share the same misalignment, batch them in one commit.
4. Validate. Commit with `fix:` prefix.

## Promote a flat-list token to a master entry

When a token in `always-latin-tokens.json` gains an established native-script form in one or more non-Latin languages and needs per-language data:

1. Remove the token from `src/data/always-latin-tokens.json` (or the equivalent flat list).
2. Add as a proper master entry in `src/data/glossary-terms-enhanced.json` with appropriate `term_role`, `script_rule` (likely `transliterate` or `transliterate_with_translation`), `casing`, and so on.
3. Populate per-language translation entries in `src/data/translations/glossary-<lang>.json` for each language that has an established form.
4. Languages without established forms can keep an aliased Latin form in the translation file (`term: "<latin form>"`).
5. Validate. Commit with `add:` prefix.

## Fix a typo in a definition or note

1. Locate the entry: `grep -n "<misspelled word>" src/data/glossary-terms-enhanced.json`.
2. Fix in place.
3. Validate (a stray escape in a JSON value can break parsing).
4. Commit with `fix:` prefix.

---

## Validation block (apply to every recipe)

After making changes, run these in order:

```bash
# JSON validity (for data file changes)
jq empty src/data/glossary-terms-enhanced.json
jq empty src/data/glossary-schema.json
for f in src/data/translations/glossary-*.json; do jq empty "$f" || echo "INVALID: $f"; done

# Data audit (for data changes)
node scripts/audit-glossary.mjs | head -60

# Build check (for any change)
pnpm run build

# Type check (informational; the URL global error is pre-existing and unrelated)
npx tsc --noEmit

# Local smoke test (build, start the server, then curl)
pnpm run build && node dist/server.js &
sleep 2
scripts/verify-deploy.sh http://127.0.0.1:8787
```

After the merge to `main` has rolled out (about five minutes):

```bash
scripts/verify-deploy.sh https://glossary.ethereum.org
```

## When in doubt

- "Is this a breaking change?" -> `docs/design-decisions.md`, **Versioning and API stability** section.
- "What's the right term_role / script_rule for this entry?" -> `docs/translation-policy.md` section 4.
- "Why is the data shaped this way?" -> `docs/data-shape.md`.
- "Is there a gotcha?" -> `docs/gotchas.md`.
- "What does the audit script's report mean?" -> the script's own header comments + `docs/data-shape.md`.
