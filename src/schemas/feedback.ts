/**
 * Request and response shapes for the feedback write API. These double as
 * runtime validation and as the OpenAPI document, like every other schema in
 * this directory.
 */

import { z } from "@hono/zod-openapi"

export const ContextIdSchema = z.enum(["prose", "heading", "tag", "ui", "plurals"]).openapi({
  description: "The translation slot the feedback is about",
  example: "prose",
})

/** The 32-hex content hash of the exact value the reviewer saw. */
export const HashSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .openapi({
    description: "Content hash of the value as rendered; the server refuses with 409 if it no longer matches",
    example: "2e69ecb0f9b3fb9dd37c0ed376166171",
  })

export const FieldIdSchema = z.enum(["definition"]).openapi({
  description: "The English field the feedback is about",
  example: "definition",
})

export const VoteItemSchema = z.object({
  context: ContextIdSchema,
  hash: HashSchema,
  direction: z.enum(["up", "down", "none"]).openapi({ description: "`none` clears your vote" }),
})

export const VotesBodySchema = z
  .object({
    votes: z.array(VoteItemSchema).min(1).max(5),
  })
  .openapi("FeedbackVotes")

export const TallySchema = z.object({
  context: ContextIdSchema,
  hash: HashSchema,
  up: z.number().int(),
  down: z.number().int(),
  mine: z.enum(["up", "down"]).nullable(),
})

export const VotesResponseSchema = z
  .object({
    ok: z.literal(true),
    tallies: z.array(TallySchema),
  })
  .openapi("FeedbackVotesResponse")

export const FieldVoteItemSchema = z.object({
  field: FieldIdSchema,
  hash: HashSchema,
  direction: z.enum(["up", "down", "none"]).openapi({ description: "`none` clears your vote" }),
})

export const FieldVotesBodySchema = z
  .object({ votes: z.array(FieldVoteItemSchema).min(1).max(5) })
  .openapi("FeedbackFieldVotes")

export const FieldTallySchema = z.object({
  field: FieldIdSchema,
  hash: HashSchema,
  up: z.number().int(),
  down: z.number().int(),
  mine: z.enum(["up", "down"]).nullable(),
})

export const FieldVotesResponseSchema = z
  .object({ ok: z.literal(true), tallies: z.array(FieldTallySchema) })
  .openapi("FeedbackFieldVotesResponse")

export const SuggestionBodySchema = z
  .object({
    context: ContextIdSchema,
    hash: HashSchema,
    value: z
      .string()
      .trim()
      .min(1)
      .max(700)
      .openapi({ description: "Up to 200 characters, except plurals: `category=form` pairs joined by `|`, up to 100 per form", example: "cuenta" }),
    reason: z.string().trim().max(1000).optional().openapi({ description: "Why this is better. Optional." }),
  })
  .openapi("FeedbackSuggestion")

export const SuggestionResponseSchema = z
  .object({
    id: z.string().uuid(),
    duplicate: z.boolean().openapi({ description: "True when you had already suggested this exact value" }),
  })
  .openapi("FeedbackSuggestionResponse")

const termId = z.string().min(1).max(200).openapi({ description: "A term id, name, alias or variant", example: "gas" })
const httpsUrl = z.string().url().refine((u) => u.startsWith("https://"), "https only")
const casing = z.enum(["standard", "proper", "uppercase", "fixed"])

/**
 * One table, one `kind` column, one payload shape per kind. The union is
 * discriminated so the OpenAPI document lists every shape.
 */
export const ProposalBodySchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("new_term"),
      lang: z.string().min(2).max(5).optional().openapi({ description: "Language being reviewed, if a translation is seeded" }),
      payload: z.object({
        term: z.string().trim().min(1).max(120),
        definition: z.string().trim().max(2000).optional(),
        translation: z.object({ lang: z.string().min(2).max(5), prose: z.string().trim().min(1).max(200) }).optional(),
      }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("redundant"),
      termId,
      hash: HashSchema.optional(),
      payload: z.object({ with: z.array(termId).min(1).max(10) }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("split"),
      termId,
      hash: HashSchema.optional(),
      payload: z.object({
        into: z.array(z.object({ term: z.string().trim().min(1).max(120), definition: z.string().trim().max(2000).optional() })).min(2).max(10),
      }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("definition"),
      termId,
      hash: HashSchema,
      payload: z.object({ definition: z.string().trim().min(1).max(2000) }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("note"),
      termId,
      hash: HashSchema,
      payload: z.object({
        note: z.string().trim().min(1).max(1000).nullable().openapi({ description: "`null` proposes removing the note" }),
      }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("references"),
      termId,
      hash: HashSchema,
      payload: z
        .object({
          add: z.array(z.object({ label: z.string().trim().min(1).max(120), url: httpsUrl })).max(10).optional(),
          remove: z.array(httpsUrl).max(10).optional(),
        })
        .refine((p) => (p.add?.length ?? 0) + (p.remove?.length ?? 0) > 0, "nothing to change"),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("avoid"),
      termId,
      hash: HashSchema,
      payload: z
        .object({
          add: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
          remove: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
        })
        .refine((p) => (p.add?.length ?? 0) + (p.remove?.length ?? 0) > 0, "nothing to change"),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("alias"),
      termId,
      hash: HashSchema,
      payload: z
        .object({
          add: z
            .array(z.object({ term: z.string().trim().min(1).max(120), status: z.enum(["preferred", "accepted", "deprecated"]).optional() }))
            .max(10)
            .optional(),
          remove: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
        })
        .refine((p) => (p.add?.length ?? 0) + (p.remove?.length ?? 0) > 0, "nothing to change"),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("casing"),
      termId,
      hash: HashSchema,
      payload: z.object({ casing }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("category"),
      termId,
      hash: HashSchema,
      payload: z.object({ category: z.string().trim().min(1).max(40) }),
      reason: z.string().trim().max(1000).optional(),
    }),
    z.object({
      kind: z.literal("script_rule"),
      termId,
      hash: HashSchema,
      payload: z.object({
        script_rule: z.enum(["translate", "calque", "transliterate", "keep_latin", "always_latin", "transliterate_with_translation"]),
      }),
      reason: z.string().trim().max(1000).optional(),
    }),
  ])
  .openapi("FeedbackProposal")

/** Several proposals in one transaction: what "Suggest changes" sends, one per field that changed. All or nothing. */
export const ProposalBatchBodySchema = z
  .object({ proposals: z.array(ProposalBodySchema).min(1).max(10) })
  .openapi("FeedbackProposalBatch")

export const ProposalBatchResponseSchema = z.object({ ids: z.array(z.string().uuid()) }).openapi("FeedbackProposalBatchResponse")

export const ProposalResponseSchema = z.object({ id: z.string().uuid() }).openapi("FeedbackProposalResponse")

export const FeedbackErrorSchema = z
  .object({
    error: z.string(),
    /** On 409: the hash of the value that is live now. */
    current: HashSchema.optional(),
    context: ContextIdSchema.optional(),
    field: FieldIdSchema.optional(),
  })
  .openapi("FeedbackError")

export const IdParamSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
})
