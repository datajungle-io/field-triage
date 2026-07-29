-- One row per org, for actually working the leads.
--
-- `leads` is one row per SCAN by design — it's the history, and it's what lets
-- you see that someone came back and re-scanned. But that makes it the wrong
-- thing to read as a contact list: an org that scanned three times appears
-- three times.
--
-- This view collapses to one row per org while keeping the history underneath:
-- who they are, when they first and last scanned, how many times, and the
-- numbers plus report link from their most recent scan.

create or replace view leads_by_org
with (security_invoker = true)
as
select distinct on (l.org_id)
    l.org_id,
    l.org_name,
    l.org_type,
    l.is_sandbox,
    -- Most recent contact details: people change roles, and the latest scan is
    -- the most likely to reach someone.
    l.name,
    l.email,
    l.username,
    first_value(l.created_at) over (partition by l.org_id order by l.created_at)      as first_scanned_at,
    l.created_at                                                                      as last_scanned_at,
    count(*) over (partition by l.org_id)                                             as scan_count,
    l.fields_scanned,
    l.objects_scanned,
    l.delete_ready,
    l.ready_no_deps,
    -- NULL once the scan payload has expired; the lead itself outlives it.
    s.token                                                                           as latest_report_token
from leads l
left join scans s on s.id = l.scan_id
order by l.org_id, l.created_at desc;

revoke all on leads_by_org from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant select on leads_by_org to service_role;
    end if;
end
$$;
