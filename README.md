# ETHGlossary

Live at [glossary.ethereum.org](https://glossary.ethereum.org).

Canonical Ethereum terminology glossary -- English style guide and translations for 24 languages.

Usage rules, casing conventions, avoid lists, and contextual translations. Built for content creators, translators, and translation pipelines.

## API

- Interactive docs: `/docs`
- OpenAPI spec: `/openapi.json`
- LLM-friendly: `/llms.txt`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/style-guide` | Full English style guide |
| GET | `/api/v1/style-guide/:termId` | Look up a term (intelligent matching) |
| GET | `/api/v1/style-guide/search?q=` | Search terms and definitions |
| GET | `/api/v1/translations/:lang` | Full glossary for a language |
| GET | `/api/v1/translations/:lang/:termId` | Single term translation |
| POST | `/api/v1/filter` | Match glossary terms in source content |
| GET | `/api/v1/languages` | Supported languages with stats |
| GET | `/api/v1/schema` | Glossary JSON schema |
| GET | `/api/v1/info` | API metadata |

### Intelligent term matching

Term lookups resolve aliases, avoid forms, and variants to canonical entries:

- `on-chain` -> `onchain` (via avoid list)
- `ZKP` -> `zero-knowledge proof` (via alias)
- `dapps` -> `decentralized application (dapp)` (via variant)

### Content filtering

POST source text to `/api/v1/filter` and get back matching glossary terms with translations. Strips code blocks, inline code, and URLs before matching.

```bash
curl -X POST https://<host>/api/v1/filter \
  -H "Content-Type: application/json" \
  -d '{"content": "Staking requires 32 ETH to run a validator.", "language": "es"}'
```

## Languages

Arabic, Bengali, Czech, German, Spanish, French, Hindi, Indonesian, Italian, Japanese, Korean, Marathi, Polish, Portuguese (Brazil), Russian, Swahili, Tamil, Telugu, Turkish, Ukrainian, Urdu, Vietnamese, Chinese (Simplified), Chinese (Traditional)

## Development

```bash
pnpm install
pnpm dev
```

Runs locally at `http://localhost:8787`.

## Stack

- [Hono](https://hono.dev) -- web framework
- [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) -- OpenAPI from Zod schemas
- [Scalar](https://scalar.com) -- API docs UI
- Container image built on every push to `main` (`.github/workflows/docker.yml`), run on Ethereum Foundation infrastructure

## License

[MPL-2.0](LICENSE)
