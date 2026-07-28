-- Lock the anon and authenticated roles out of everything.
--
-- Enabling RLS on the tables is NOT sufficient on its own, for two reasons:
--
--   1. A view does not inherit RLS from the tables beneath it. By default a view
--      runs with its owner's privileges, so `field_census` and
--      `field_references_deduped` would happily serve every scan's data over
--      PostgREST to anyone holding the anon key — which is a public value.
--
--   2. Functions are exposed as RPC endpoints. `purge_expired_scans` DELETES,
--      so leaving it callable by anon is a data-loss button on the public
--      internet.
--
-- This app never reads from the browser: report pages render server-side under
-- the service role after verifying the request's scan token. So the correct
-- posture is to grant the public roles nothing at all.

-- Belt: make the views respect the RLS policies of their base tables (PG15+),
-- so even an accidental grant later can't leak rows.
alter view field_census set (security_invoker = true);
alter view field_references_deduped set (security_invoker = true);

-- Postgres grants EXECUTE on every new function to PUBLIC, and anon is a member
-- of PUBLIC — so revoking from anon alone leaves the grant intact. Today the
-- functions are all SECURITY INVOKER and RLS stops them returning anything, but
-- the first SECURITY DEFINER function anyone adds would be reachable by the
-- public anon key. Close it at the source, then hand execute back to the one
-- role that needs it.
revoke all on all functions in schema public from public;

-- service_role is the app's only database principal, so grant it explicitly
-- rather than relying on Supabase's default privileges reaching these objects.
-- They don't reliably: migrations run as `postgres`, and whether service_role
-- inherits depends on which role the ALTER DEFAULT PRIVILEGES was attached to.
-- Being explicit here is both correct and self-documenting.
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant usage on schema public to service_role;
        grant all on all tables in schema public to service_role;
        grant all on all sequences in schema public to service_role;
        grant execute on all functions in schema public to service_role;
    end if;
end
$$;

-- Braces: revoke outright. Wrapped in a guard because these roles exist on
-- Supabase but not in a bare Postgres (or in the PGlite test harness).
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on all tables in schema public from anon;
        revoke all on all functions in schema public from anon;
        revoke all on all sequences in schema public from anon;
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on all tables in schema public from authenticated;
        revoke all on all functions in schema public from authenticated;
        revoke all on all sequences in schema public from authenticated;
    end if;
end
$$;

-- Supabase's default privileges re-grant SELECT to anon on anything created
-- later, so shut that off too — a future migration must not silently reopen
-- this. The PUBLIC default on functions is revoked here for the same reason.
alter default privileges in schema public revoke execute on functions from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        alter default privileges in schema public grant all on tables to service_role;
        alter default privileges in schema public grant all on sequences to service_role;
        alter default privileges in schema public grant execute on functions to service_role;
    end if;

    if exists (select 1 from pg_roles where rolname = 'anon') then
        alter default privileges in schema public revoke all on tables from anon;
        alter default privileges in schema public revoke all on functions from anon;
        alter default privileges in schema public revoke all on sequences from anon;
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        alter default privileges in schema public revoke all on tables from authenticated;
        alter default privileges in schema public revoke all on functions from authenticated;
        alter default privileges in schema public revoke all on sequences from authenticated;
    end if;
end
$$;
