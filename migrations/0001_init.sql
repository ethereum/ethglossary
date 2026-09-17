-- 0001_init.sql -- community feedback schema, first cut.
--
-- Plain PostgreSQL, nothing extension-specific. Every id is a random UUID
-- minted by the application, never a sequence, so rows can be moved between
-- databases without renumbering. Applied at startup by src/db/migrate.ts;
-- never edit a file that has shipped -- add the next number.
--
-- Design notes live in AGENTS.md ("Database"). Read that before changing this.

-- ---------------------------------------------------------------- accounts

-- One row per person, one sign-in method per person. (provider, subject) is
-- the only thing we need to know about a user: the provider's stable id --
-- lowercased 0x address for siwe, numeric id for github, snowflake for
-- discord. display_name is a vanity label the user sees on their own account
-- and maintainers see in exports; it is not unique and not verified.
-- ens_name IS verified (reverse record, forward-checked) and only ever set
-- for siwe users.
--
-- Self-deletion nulls subject, display_name and ens_name and sets
-- deleted_at: the row stays as an anonymous author for the user's past
-- feedback and the person can sign up again fresh. A ban sets banned_at and
-- keeps subject, so the same identity cannot sign in again.
CREATE TABLE users (
  id            text PRIMARY KEY,
  provider      text NOT NULL CHECK (provider IN ('siwe', 'github', 'discord', 'passkey')),
  subject       text,
  display_name  text,
  ens_name      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  banned_at     timestamptz,
  UNIQUE (provider, subject)
);

-- The cookie carries a random 256-bit token; only its SHA-256 is stored, so a
-- read of this table cannot be replayed as a session.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user    ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Short-lived, single-use values a sign-in flow has to remember between two
-- requests: the SIWE nonce, the OAuth state. id IS the nonce/state. Rows are
-- deleted on use and swept by expiry.
CREATE TABLE auth_challenges (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('siwe_nonce', 'oauth_state')),
  provider    text CHECK (provider IN ('siwe', 'github', 'discord')),
  -- Same-origin path to return to after sign-in. Validated as a path on the
  -- way in; never a full URL.
  next_path   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX auth_challenges_expires ON auth_challenges (expires_at);

-- ---------------------------------------------------- glossary versioning

-- One row per deployed build the indexer has seen. version_id is the image's
-- git SHA in production and a content hash of the bundled data in development.
CREATE TABLE glossary_snapshots (
  id            text PRIMARY KEY,
  version_id    text NOT NULL UNIQUE,
  git_sha       text,
  deployed_at   timestamptz NOT NULL,
  term_count    integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

-- What the glossary looked like the last time the indexer ran: one row per
-- (term, language) holding that entry's slot hashes and values keyed by
-- context. The indexer diffs the bundled data against this to produce
-- term_changes, then overwrites it.
CREATE TABLE entry_state (
  term_uid     text NOT NULL,
  lang         text NOT NULL,
  snapshot_id  text NOT NULL REFERENCES glossary_snapshots(id),
  slot_hashes  jsonb NOT NULL,
  slot_values  jsonb NOT NULL,
  PRIMARY KEY (term_uid, lang)
);

-- Same for the English master entry: the hash of the fields a reader can give
-- feedback on, plus the canonical term so a rename can be reported.
CREATE TABLE term_state (
  term_uid     text PRIMARY KEY,
  snapshot_id  text NOT NULL REFERENCES glossary_snapshots(id),
  fields_hash  text NOT NULL,
  term         text NOT NULL
);

-- The Versions rail. One row per (term, language, slot) that changed in a
-- deploy, plus term-level rows for master-file changes. lang and context are
-- NULL for term-level kinds. Old and new values are recorded because they
-- are free at diff time; the rail may show dates only.
CREATE TABLE term_changes (
  id           text PRIMARY KEY,
  snapshot_id  text NOT NULL REFERENCES glossary_snapshots(id) ON DELETE CASCADE,
  term_uid     text NOT NULL,
  lang         text,
  context      text CHECK (context IN ('prose', 'heading', 'tag', 'ui', 'plurals')),
  kind         text NOT NULL CHECK (kind IN (
                 'term_added', 'term_changed', 'term_renamed', 'term_removed',
                 'slot_added', 'slot_changed', 'slot_removed')),
  old_value    text,
  new_value    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX term_changes_term ON term_changes (term_uid, lang, snapshot_id);

-- When a term is merged into another, feedback on the loser can be read as
-- feedback on the survivor at export time. Written by hand as part of the
-- merge, never by the application.
CREATE TABLE term_redirects (
  from_uid    text PRIMARY KEY,
  to_uid      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

-- ------------------------------------------------------------- candidates

-- A specific value a translation slot has held. Votes and suggestions point
-- here, never at the slot itself, so feedback is always about the exact
-- string the reviewer saw. Rows are created lazily by the application on the
-- first vote or suggestion against a value; "is this the current value" is
-- decided at request time by hashing the bundled glossary, never by reading
-- this table. superseded_at is set by the indexer as a convenience for
-- exports and is not consulted by the application.
--
-- value is the slotValue() serialization from src/lib/context-types.ts;
-- value_hash is its SHA-256, hex, truncated to 32 characters.
CREATE TABLE slot_versions (
  id             text PRIMARY KEY,
  term_uid       text NOT NULL,
  lang           text NOT NULL,
  context        text NOT NULL CHECK (context IN ('prose', 'heading', 'tag', 'ui', 'plurals')),
  value_hash     text NOT NULL,
  value          text NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  UNIQUE (term_uid, lang, context, value_hash)
);
CREATE INDEX slot_versions_lang_term ON slot_versions (lang, term_uid);

-- Same idea for the English side. fields_hash covers the master fields a
-- reader can give feedback on (term, definition, references, avoid, aliases,
-- casing, note, script_rule, term_role, category). Metadata proposals anchor
-- here so an accepted or superseded proposal can be told from a stale one.
CREATE TABLE term_versions (
  id             text PRIMARY KEY,
  term_uid       text NOT NULL,
  fields_hash    text NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  UNIQUE (term_uid, fields_hash)
);

-- --------------------------------------------------------------- feedback

-- One vote per user per slot value. Changing your mind updates the row;
-- clearing the vote deletes it. direction is +1 or -1.
CREATE TABLE votes (
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_version_id  text NOT NULL REFERENCES slot_versions(id) ON DELETE CASCADE,
  direction        smallint NOT NULL CHECK (direction IN (-1, 1)),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot_version_id)
);
CREATE INDEX votes_slot         ON votes (slot_version_id);
CREATE INDEX votes_user_created ON votes (user_id, created_at);

-- "This slot should read X instead." Visible to the author and to
-- maintainers, nobody else. normalized_value (NFC, trimmed, internal
-- whitespace collapsed, case kept) is what the export groups on, so five
-- people suggesting the same string read as one suggestion with five
-- supporters. Status is set by maintainers via scripts, never by the site.
CREATE TABLE suggestions (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_version_id   text NOT NULL REFERENCES slot_versions(id) ON DELETE CASCADE,
  value             text NOT NULL,
  normalized_value  text NOT NULL,
  reason            text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolution_note   text,
  UNIQUE (user_id, slot_version_id, normalized_value)
);
CREATE INDEX suggestions_slot         ON suggestions (slot_version_id, normalized_value);
CREATE INDEX suggestions_user_created ON suggestions (user_id, created_at);
CREATE INDEX suggestions_status       ON suggestions (status, created_at);

-- Everything that is not a vote or a slot suggestion: a new English term, a
-- redundancy or split flag, or a change to one English metadata field. The
-- payload shape is fixed per kind and validated with Zod before insert.
-- term_uid is NULL for new_term; term_version_id anchors metadata kinds to
-- the version the author was looking at; lang is set when a new_term
-- carries a seeded translation.
CREATE TABLE proposals (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN (
                     'new_term', 'redundant', 'split',
                     'definition', 'references', 'avoid', 'casing', 'alias', 'note')),
  term_uid         text,
  term_version_id  text REFERENCES term_versions(id) ON DELETE SET NULL,
  lang             text,
  payload          jsonb NOT NULL,
  reason           text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution_note  text
);
CREATE INDEX proposals_term         ON proposals (term_uid, kind);
CREATE INDEX proposals_user_created ON proposals (user_id, created_at);
CREATE INDEX proposals_status       ON proposals (status, created_at);
