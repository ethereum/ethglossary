-- Withdrawing feedback marks the row instead of deleting it. The author
-- still sees it on their account page, an accidental withdrawal is undone by
-- making the same suggestion again (which reopens the same row), and the
-- review export, which defaults to open items, never sees it. resolved_at is
-- the moment a row left the open state, whoever closed it.

ALTER TABLE suggestions DROP CONSTRAINT suggestions_status_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check
  CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn'));

ALTER TABLE proposals DROP CONSTRAINT proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn'));
