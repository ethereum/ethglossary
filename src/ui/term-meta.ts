/**
 * What a term's metadata values mean, in a sentence each, for the chips on
 * the style guide page and the explainers in the suggest-changes dialog. The
 * authoritative definitions are docs/data-shape.md and
 * docs/translation-policy.md; this is the reader-facing gloss of them.
 */

export const CASING_MEANING: Record<string, string> = {
  standard: "An ordinary noun: capitalized only at the start of a sentence (ether, smart contract).",
  proper: "Always capitalized, like a name (Ethereum, Solidity).",
  uppercase: "Always all caps (EVM, NFT, ETH).",
  fixed: "Written exactly as the term shows, never altered (The Merge, zkEVM, MetaMask).",
}

export const SCRIPT_RULE_MEANING: Record<string, string> = {
  translate: "Rendered in each language's own words.",
  transliterate: "Spelled out phonetically in the target script.",
  keep_latin: "Kept in Latin script by editorial choice, for branding or clarity.",
  always_latin: "Always Latin: translating it would break code, a spec or an identifier (Solidity, ETH, ERC-20).",
  calque: "Translated piece by piece into a native-script equivalent.",
  transliterate_with_translation: "The Latin form plus a short gloss in the target script.",
  hybrid: "Legacy value: handling varies by sense, and the entry is due to be split.",
  context_dependent: "Legacy value: handling depends on where the term appears, and the entry is due to be split.",
}

export const CATEGORY_MEANING = "The topic the term is filed under in the style guide list, used to filter it."

export const casingMeaning = (v: string) => CASING_MEANING[v] ?? "How the term is capitalized."
export const scriptRuleMeaning = (v: string) =>
  SCRIPT_RULE_MEANING[v] ?? "How the term is carried into languages that do not use the Latin script."
