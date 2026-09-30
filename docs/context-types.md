# Translation contexts

Load this when working on anything that reads, writes, or votes on a
per-context translation form. The user-facing version of this page is served
at `/contexts`; the machine-readable source is `src/lib/context-types.ts`.

A glossary term does not have one translation. The same English word behaves
differently in running text, in a heading, on a filter chip and on a button,
so each of those is stored separately. These are the votable units of community
feedback.

## The five slots

Worked example: **externally owned account (EOA)** in English, Spanish and
Russian. All three are genuine translations -- Russian gives
"внешний аккаунт", where "внешний" is the Russian for *external* and "аккаунт"
is *account* borrowed and spelled phonetically.

Because Cyrillic is not Latin script, the entry additionally records a
romanization in `transliteration` (`vneshniy akkaunt (EOA)`) -- the Russian
spelled in Latin letters, as a pronunciation aid. That is a separate field
from the five slots, and it is **not** the English transliterated.

| Slot | Where it appears | en | es | ru |
|------|------------------|----|----|----|
| `prose` | Running text, sentences, documentation | externally owned account | cuenta de propiedad externa | внешнего аккаунта |
| `heading` | Section titles and page headings | Externally Owned Account (EOA) | Cuenta de Propiedad Externa (EOA) | Внешний аккаунт (EOA) |
| `tag` | Category chips, filter pills, metadata labels | EOA | EOA | EOA |
| `ui` | Buttons, menu items, interface controls | External account (EOA) | Cuenta externa (EOA) | Внешний аккаунт |
| `plurals` | CLDR categories, where the language marks them | accounts | 2 forms | **5 forms** |

That row of `EOA`s is the point of `tag`, and two-versus-five is the point of
`plurals`. The /contexts page renders this table from the live glossary rather
than from authored copy, so it cannot drift from the data.

`prose` through `ui` live under `entry.contexts.<slot>.term`. `plurals` is a
separate top-level object keyed by CLDR category (`one`, `two`, `few`, `many`,
`other`), not all of which every language uses.

### Why `ui` diverges most

`ui` is the slot that most often differs from `prose`, because a control has to
stay short and scannable. Above, every language drops below the full phrase and
Russian sheds the acronym entirely. Translators should render what the control
*does* in their language, not translate the phrase word for word.

### Why there is no `code` slot

There used to be one. It did not survive contact with its own data: it varied
by language in two thirds of terms despite being documented as "almost always
the English original", it was the `id` slug in different casing 93% of the
time, and every language mixed five to seven casing conventions. Identifier
casing belongs to the codebase and the position, not to the term --
`gasPrice` in Solidity, `gas_price` in Python, `GAS_PRICE` as a constant.

Code is excluded structurally instead, on both sides of the integration:

- `POST /api/v1/filter` strips fenced blocks and inline code before matching,
  so a term inside backticks is never returned.
- Consumers extract code blocks to placeholders before a model sees them.
- **Code comments are the exception** -- prose that happens to sit inside a
  block, and translated as prose.
- Where a term must stay Latin in running prose, that is its own
  `script_rule`: `always_latin` or `keep_latin`, decided once per term.

Full reasoning and evidence: "Code is not translated" in
`docs/design-decisions.md`.

## The slot count is never fixed

**Do not assume five slots.** Always derive them with
`applicableContexts(entry)` from `src/lib/context-types.ts`.

Measured across all 24 language files (541 entries each):

- `prose`, `heading`, `tag`, `ui` -- **100% coverage, every language**.
- `plurals` -- absent entirely for six languages, and partial for the rest.

| Plural coverage | Languages |
|-----------------|-----------|
| None (0 of 541) | `id`, `ja`, `ko`, `vi`, `zh`, `zh-tw` |
| Highest | `pl` 490, `cs` 488, `ru` 481 |
| Lowest | `bn` 260, `tr` 324, `ur` 363 |

The six languages with no plurals do not mark them grammatically, so their
absence is correct data, not missing data. No feedback is collected on a slot
that does not exist.

Because coverage also varies *term by term* within a language, "this user has
reviewed every context" has to be computed per term, per language, from the
slots actually populated in that entry. A term with no plural form is complete
at four slots, not incomplete at five.

## Consequences for feedback storage

- A vote is one row per `(user, slot version)`, where a slot version is
  `(term_uid, lang, context, value_hash)`: the hash of `slotValue()` for the
  exact value the reviewer saw. Editing one context therefore expires
  feedback on that context alone, and a rollback revives it.
- Terms are identified by `uid` (stable, see `scripts/term-uid.mjs`), never
  by the canonical name or the `id` slug, both of which change on rename.
  Translation files are still keyed by canonical name; the store joins
  through the master entry.
- Progress state is derived, never stored: the reader's covered
  `(uid, context, hash)` set against `applicableContexts(entry)` and the
  live hashes. See `src/feedback/store.ts` and `buildTermList()` in
  `src/routes/viewer.tsx`.
