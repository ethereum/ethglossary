# Ethereum Glossary API -- Specification (DRAFT)

**Status:** Draft, pending maintainer review
**Date:** 2026-04-12
**Stack:** Hono + @hono/zod-openapi + Scalar (auto-generated docs)
**Deployment:** Container on Ethereum Foundation infrastructure at `https://glossary.ethereum.org` (Hono is runtime-portable)
**Data storage:** Static JSON bundled with the app (glossary), Postgres (future feedback)

---

## Overview

A standalone API and viewer for the Ethereum.org glossary. Serves as:

1. **Translation reference** -- canonical term translations for 24 languages
2. **English style guide** -- authoritative usage rules, casing, avoid lists
3. **Pipeline integration** -- content-aware term filtering for translation pipelines
4. **Community tool** -- browsable viewer with future feedback capability

---

## Design Principles

- **Read-only for Phase 1.** Data managed via git/JSON. API serves it.
- **Designed for writes (Phase 2).** Community feedback (votes, suggestions) added later without rewrite.
- **Edge-first.** Glossary data served from nearest PoP globally.
- **Self-documenting.** OpenAPI spec auto-generated from Zod schemas. Scalar UI served at `/docs`.
- **Portable.** Hono runs on Workers, Netlify, Deno, Node. No vendor lock-in.

---

## Phase 1 Endpoints (Read-Only)

### Info

#### `GET /api/v1/info`

Health check and metadata.

**Response:**

```json
{
  "version": "1.0.0",
  "termCount": 486,
  "languageCount": 24,
  "lastUpdated": "2026-04-12T00:00:00Z",
  "languages": ["ar", "bn", "cs", "de", "es", "fr", "hi", "id", "it", "ja", "ko", "mr", "pl", "pt-br", "ru", "sw", "ta", "te", "tr", "uk", "ur", "vi", "zh", "zh-tw"]
}
```

---

### Style Guide (English)

The English editorial layer. Not a translation -- a content standardization reference.

#### `GET /api/v1/style-guide`

Full English style guide. All terms with canonical forms, casing rules, avoid lists, usage notes.

**Query parameters:**

| Param      | Type   | Description                          | Example              |
|------------|--------|--------------------------------------|----------------------|
| `category` | string | Filter by category (comma-separated) | `defi,scaling`       |

**Response:**

```json
{
  "termCount": 486,
  "terms": [
    {
      "id": "onchain",
      "term": "onchain",
      "category": "general",
      "casing": "standard",
      "definition": "Refers to actions or data that exist on the blockchain...",
      "avoid": ["on chain", "on-chain", "On Chain", "On-chain"],
      "aliases": [
        { "term": "onchain", "status": "preferred" }
      ],
      "note": "Always one word, no hyphen, lowercase unless starting a sentence.",
      "scriptRule": "translate",
      "hasTooltip": true
    }
  ]
}
```

#### `GET /api/v1/style-guide/:termId`

Single term style guide entry. Supports intelligent matching (see Term Resolution below).

**Response:** Single term object from the shape above.

#### `GET /api/v1/style-guide/search?q=:query`

Fuzzy search across terms, definitions, aliases, and avoid lists.

**Query parameters:**

| Param | Type   | Description                | Example   |
|-------|--------|----------------------------|-----------|
| `q`   | string | Search query (required)    | `staking` |
| `limit`| number | Max results (default: 20) | `10`      |

**Response:**

```json
{
  "query": "staking",
  "results": [
    {
      "id": "staking",
      "term": "staking",
      "matchedOn": "term",
      "score": 1.0
    },
    {
      "id": "staking-pool",
      "term": "staking pool",
      "matchedOn": "term",
      "score": 0.85
    },
    {
      "id": "solo-staking",
      "term": "solo staking",
      "matchedOn": "alias",
      "score": 0.8
    }
  ]
}
```

---

### Translations

#### `GET /api/v1/languages`

Supported languages with completion metadata.

**Response:**

```json
{
  "languages": [
    {
      "code": "es",
      "name": "Spanish",
      "nativeName": "Espanol",
      "translatedTerms": 486,
      "totalTerms": 486,
      "completionPercent": 100,
      "confidenceBreakdown": { "high": 420, "medium": 58, "low": 8 }
    }
  ]
}
```

#### `GET /api/v1/translations/:lang`

Full glossary for a single language. Returns all translated terms with their contextual forms.

**Response:**

```json
{
  "language": "es",
  "termCount": 486,
  "terms": {
    "staking": {
      "term": "staking",
      "contexts": {
        "prose": { "term": "staking", "example": "..." },
        "heading": { "term": "Staking" },
        "tag": { "term": "staking" },
        "ui": { "term": "Staking" }
      },
      "plurals": { "one": "staking", "other": "staking" },
      "grammar": { "gender": "masculine", "partOfSpeech": "noun" },
      "confidence": "high"
    }
  }
}
```

#### `GET /api/v1/translations/:lang/:termId`

Single term translation. Supports intelligent matching.

**Response:** Single term object from the shape above, plus the English source data for reference.

```json
{
  "english": {
    "id": "staking",
    "term": "staking",
    "definition": "..."
  },
  "translation": {
    "term": "staking",
    "contexts": { ... },
    "plurals": { ... },
    "confidence": "high"
  }
}
```

---

### Content Filter

The pipeline integration endpoint. Send source text, get back the glossary terms relevant to that content.

#### `POST /api/v1/filter`

**Request body:**

```json
{
  "content": "Staking is the act of depositing 32 ETH to activate validator software...",
  "language": "es",
  "fileType": "markdown",
  "includeExamples": true
}
```

| Field             | Type   | Required | Description                                      |
|-------------------|--------|----------|--------------------------------------------------|
| `content`         | string | yes      | Source text (sentence to full page)               |
| `language`        | string | yes      | Target language code                              |
| `fileType`        | string | no       | `markdown` or `json` (default: `markdown`)        |
| `includeExamples` | bool   | no       | Include example sentences for high-frequency terms (default: false) |

**Response:**

```json
{
  "language": "es",
  "matchedTerms": 5,
  "totalScanned": 486,
  "terms": [
    {
      "english": "staking",
      "translation": "staking",
      "note": "Loanword -- kept in English across all languages.",
      "example": "El staking es el acto de depositar 32 ETH...",
      "occurrences": 3
    },
    {
      "english": "validator",
      "translation": "validador",
      "occurrences": 2
    },
    {
      "english": "ether (ETH)",
      "translation": "ether (ETH)",
      "note": "Keep 'ETH' in Latin script. 'ether' is translatable.",
      "occurrences": 1
    }
  ]
}
```

**Notes:**
- Uses the same `filterGlossaryForSource` logic currently in `glossary-lookup.ts`
- Strips code blocks, inline code, URLs before matching (same as current behavior)
- Extracts link text for matching (same as current behavior)
- Terms sorted by occurrence count (highest first)

---

### Schema

#### `GET /api/v1/schema`

Returns the JSON schema for the glossary data structure.

**Response:** The raw `glossary-schema.json` content.

---

## Term Resolution (Intelligent Matching)

Single-term endpoints (`/api/style-guide/:termId` and `/api/translations/:lang/:termId`) support intelligent matching. The resolution order:

1. **Exact ID match:** `staking` -> term with id `staking`
2. **Exact term match (case-insensitive):** `Staking` -> term "staking"
3. **Alias match:** `ZKP` -> term "zero-knowledge proof"
4. **Morphological match:** `stakers` -> term "staker"
5. **Avoid list match:** `on-chain` -> term "onchain" (returns canonical form)
6. **Fuzzy match (fallback):** `stakin` -> term "staking" (with lower confidence)

**If no match:** 404 with a `suggestions` array of close matches.

```json
{
  "error": "Term not found",
  "query": "stakin",
  "suggestions": [
    { "id": "staking", "term": "staking", "score": 0.9 },
    { "id": "staker", "term": "staker", "score": 0.7 }
  ]
}
```

---

## Phase 2: Community Feedback

Designed, not yet built. The decisions live in `docs/design-decisions.md`
(**Auth**, **Storage**): GitHub, Discord and SIWE sign-in with one method per
account, no passwords or emails; feedback stored in the Postgres database
devops provides as `DATABASE_URL`; schema as plain SQL in `migrations/`. The
write routes under `/api/v1/feedback` will be documented by `/openapi.json`
when they ship. Feedback is advisory: it is exported for maintainer review and
never changes what the site or API serves.

---

## Data Flow

```
glossary repo (JSON files)
    |
    v
Deploy to Workers (bundle or KV)
    |
    v
Hono API (read-only endpoints)
    |
    +---> Pipeline calls POST /api/v1/filter
    +---> Viewer app calls GET /api/v1/style-guide, /api/v1/translations
    +---> Community calls GET /api/v1/translations/:lang/:termId
    +---> (Phase 2) Community submits POST /api/v1/feedback
```

---

## Frontend Viewer

Served at the root (`/`). Replaces the current `index.html` dashboard.

### Tabs/Views

1. **Style Guide** -- English editorial reference. Search, browse by category, see canonical forms and avoid lists.
2. **Browse Terms** -- All terms with translations. Select a language, see translations side-by-side with English.
3. **By Language** -- Language-centric view. Coverage stats, confidence breakdown, browse all terms for one language.
4. **API Docs** -- Scalar-rendered OpenAPI documentation at `/docs`.

---

## Deployment

### Container on Ethereum Foundation infrastructure

- **Runtime:** Hono, in a container built by `.github/workflows/docker.yml` on every push to `main`
- **Static data:** Glossary JSON bundled with the app
- **Database:** Postgres for Phase 2 feedback, provided as `DATABASE_URL`
- **Docs:** Scalar UI served at `/docs`
- **CI/CD:** push to `main` -> image on `ghcr.io/ethereum/ethglossary` -> rollout within about five minutes

### Environment Variables

```
# Phase 1: None required for read-only
# Phase 2 (injected by devops into the running container, never committed):
DATABASE_URL=...         # Postgres connection string
GITHUB_CLIENT_ID=...     # GitHub OAuth App
GITHUB_CLIENT_SECRET=...
```

---

## Decisions (Resolved)

### 1. Authentication (Phase 2)

Decided 2026-09-09; the current decision lives in `docs/design-decisions.md` under **Auth**: GitHub, Discord and SIWE in the first release, passkeys next, one sign-in method per account, no passwords, no emails, no Google. Sessions are opaque tokens stored hashed in Postgres.

### 2. Rate Limiting

- **Content size cap:** 1MB max per filter request (pipeline caps LLM requests at ~64KB, so 1MB provides comfortable headroom)
- **Request rate:** Generous to start -- 100 req/min per IP for reads, 20 req/min for filter (POST). Adjustable through environment configuration.
- **429 response** with `Retry-After` header when exceeded.

### 3. Caching

Glossary data changes very infrequently. Aggressive caching is appropriate.

| Endpoint group    | Cache-Control                                      | Rationale                                    |
|-------------------|----------------------------------------------------|----------------------------------------------|
| `/api/v1/info`    | `public, max-age=3600` (1hr)                       | Term count/metadata may update on deploy      |
| `/api/v1/style-guide/*` | `public, max-age=86400, stale-while-revalidate=604800` (1d, stale OK for 7d) | Changes are infrequent, staleness is low-risk |
| `/api/v1/languages` | `public, max-age=86400` (1d)                     | Completion stats change only on data deploy   |
| `/api/v1/translations/*` | `public, max-age=86400, stale-while-revalidate=604800` (1d, stale OK for 7d) | Daily refresh so casing/typo fixes propagate within a day; SWR keeps responses instant |
| `/api/v1/filter`  | `no-store`                                         | POST, dynamic per-request                     |
| `/api/v1/schema`  | `public, max-age=604800` (7d)                      | Schema rarely changes                         |

`stale-while-revalidate` ensures users get instant responses from cache while the server fetches fresh data in the background on the next request after expiry.

### 4. API Versioning

All endpoints prefixed with `/api/v1/` from day one. Breaking changes get a new version prefix. Non-breaking additions (new fields, new endpoints) stay in the current version.
