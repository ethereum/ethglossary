-- English fields get the same anchoring as translation slots: a version per
-- (term, field, hash of that field's text) and votes against the version. The
-- field is hashed on its own, so a vote on the definition survives an edit to
-- the note. Only the definition is votable for now; widening `field` is one
-- line here when another field earns a thumb.

CREATE TABLE field_versions (
  id          text PRIMARY KEY,
  term_uid    text NOT NULL,
  field       text NOT NULL CONSTRAINT field_versions_field_check CHECK (field IN ('definition')),
  value_hash  text NOT NULL,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_uid, field, value_hash)
);

CREATE TABLE field_votes (
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_version_id  text NOT NULL REFERENCES field_versions(id) ON DELETE CASCADE,
  direction         smallint NOT NULL CONSTRAINT field_votes_direction_check CHECK (direction IN (-1, 1)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, field_version_id)
);
CREATE INDEX field_votes_version ON field_votes (field_version_id);

-- A term's topical category and its script rule (how it is carried into
-- non-Latin scripts, the most consequential per-term decision for
-- translators) are reviewable like its other metadata.
ALTER TABLE proposals DROP CONSTRAINT proposals_kind_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_kind_check CHECK (kind IN (
  'new_term', 'redundant', 'split',
  'definition', 'references', 'avoid', 'casing', 'alias', 'note', 'category', 'script_rule'));
