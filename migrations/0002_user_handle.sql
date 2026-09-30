-- 0002_user_handle.sql -- keep the provider's human handle beside its id.
--
-- users.subject identifies a person; the handle (GitHub login, Discord
-- username) is what a maintainer reading an export can actually recognise.
-- Refreshed on every sign-in, NULL for wallets (ens_name covers them), and
-- nulled with the rest of the identity when an account is deleted. Never
-- shown to other visitors.
ALTER TABLE users ADD COLUMN handle text;
