-- Marks a scan whose token came from the `sf` CLI rather than the OAuth flow.
--
-- Exists for one reason: finalize must NOT revoke a CLI session. Revoking it
-- would log the developer out of `sf` for that org — a genuinely destructive
-- side effect of running a test. The OAuth path still revokes, always.
alter table scans
    add column if not exists is_cli_session boolean not null default false;
