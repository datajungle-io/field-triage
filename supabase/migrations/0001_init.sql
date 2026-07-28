-- Field Triage lead magnet — schema.
--
-- Mirrors the production pipeline in canopy-data-jungle, collapsed from
-- (Airbyte + BigQuery + dbt) into one Postgres database scoped by scan_id:
--
--   salesforce/jobs/ingest_field_definition.py     -> scan_fields (metadata columns)
--   salesforce/jobs/ingest_field_population_sf.py  -> scan_fields (population columns)
--   salesforce/jobs/ingest_field_layouts.py        -> scan_fields.on_layout
--   salesforce/jobs/ingest_field_references.py     -> scan_field_refs + scan_phases
--   dbt marts/field_census/fct_field_census.sql    -> field_census (view, below)
--
-- Every table is scoped by scan_id and carries no Salesforce record data — only
-- metadata and aggregate COUNT() results.

-- gen_random_uuid() is core since Postgres 13, so no pgcrypto dependency here.

-- ---------------------------------------------------------------------------
-- scans
-- ---------------------------------------------------------------------------

create type scan_status as enum ('pending', 'running', 'complete', 'failed', 'expired');

create table scans (
    id                        uuid primary key default gen_random_uuid(),
    -- Unguessable permalink segment. This is the only credential needed to read a
    -- report, so it must have real entropy (32 bytes, base64url) — never the uuid.
    token                     text        not null unique,

    org_id                    text        not null,
    org_name                  text,
    org_type                  text,
    instance_url              text        not null,
    is_sandbox                boolean     not null default false,

    status                    scan_status not null default 'pending',
    error                     text,

    -- Encrypted at rest (AES-256-GCM, app-managed key) because the resumable tick
    -- runner needs it across invocations. Set to NULL and revoked at Salesforce in
    -- the finalize phase, or by the reaper cron for abandoned scans.
    sf_access_token_encrypted text,
    token_revoked_at          timestamptz,

    created_at                timestamptz not null default now(),
    -- Bumped by every tick. The cron treats a scan whose heartbeat has gone stale
    -- as stalled and re-kicks it from its cursor.
    heartbeat_at              timestamptz not null default now(),
    completed_at              timestamptz,
    expires_at                timestamptz not null default now() + interval '30 days'
);

create index scans_heartbeat_idx on scans (status, heartbeat_at)
    where status in ('pending', 'running');
create index scans_expiry_idx on scans (expires_at);

-- ---------------------------------------------------------------------------
-- leads — one row per connected org, populated in the identity phase
-- ---------------------------------------------------------------------------

create table leads (
    id             uuid primary key default gen_random_uuid(),
    -- set null, NOT cascade: when a scan's payload expires the lead must survive.
    -- Nullable + a unique index (Postgres allows many NULLs) keeps one lead per
    -- live scan while letting expired ones detach rather than disappear.
    scan_id        uuid references scans (id) on delete set null,

    name           text,
    email          text,
    username       text,
    user_id        text,
    org_id         text,
    org_name       text,
    org_type       text,
    is_sandbox     boolean not null default false,

    -- Denormalised headline numbers, written at finalize so the alert email and
    -- any lead-magnet reporting don't have to re-aggregate the census.
    fields_scanned integer,
    objects_scanned integer,
    delete_ready   integer,
    ready_no_deps  integer,

    created_at     timestamptz not null default now()
);

create index leads_email_idx on leads (email);
create unique index leads_scan_idx on leads (scan_id);

-- ---------------------------------------------------------------------------
-- scan_phases — resumable job state AND the coverage banner.
--
-- Direct equivalent of raw_salesforce_jobs.field_reference_scan_stats: the
-- (total, scanned, failed) triple is what lets the report disclose blind spots
-- instead of silently undercounting. A source that failed must never be
-- indistinguishable from a source that found nothing.
-- ---------------------------------------------------------------------------

create type phase_status as enum ('pending', 'running', 'complete', 'failed', 'skipped');

create table scan_phases (
    scan_id    uuid         not null references scans (id) on delete cascade,
    phase      text         not null,
    position   integer      not null,
    status     phase_status not null default 'pending',

    -- Resume point within the phase (object index, report index, retrieve job id …).
    cursor     jsonb        not null default '{}'::jsonb,
    total      integer      not null default 0,
    scanned    integer      not null default 0,
    failed     integer      not null default 0,
    error      text,

    started_at   timestamptz,
    completed_at timestamptz,

    primary key (scan_id, phase)
);

-- ---------------------------------------------------------------------------
-- scan_fields — one row per (object, field).
-- Union of ingest_field_definition + ingest_field_population_sf + ingest_field_layouts.
-- ---------------------------------------------------------------------------

create table scan_fields (
    scan_id             uuid    not null references scans (id) on delete cascade,
    object_name         text    not null,
    field_api_name      text    not null,

    -- 18-char CustomField Id for custom fields (also the join key to
    -- MetadataComponentDependency.RefMetadataComponentId); the API name for
    -- standard fields, which Object Manager URLs accept.
    field_id            text,
    field_label         text,
    sf_type             text,
    namespace_prefix    text,
    is_custom           boolean not null,
    last_modified_date  timestamptz,

    -- Heuristic flag from the label text, ported from stg_sf_field_metadata.sql.
    is_deprecated_label boolean not null default false,

    -- Population. NULL populated_count means "not measurable" (compound address /
    -- name fields are not aggregatable), which is NOT the same as zero — the
    -- census surfaces it as its own 'No Data' bucket rather than calling it dead.
    populated_count     bigint,
    total_records       bigint,
    population_pct      double precision,
    is_boolean          boolean not null default false,
    aggregatable        boolean not null default false,
    includes_archived   boolean not null default false,

    on_layout           boolean not null default false,

    primary key (scan_id, object_name, field_api_name)
);

create index scan_fields_field_id_idx on scan_fields (scan_id, field_id)
    where field_id is not null;

-- ---------------------------------------------------------------------------
-- scan_field_refs — "Where is this used?", union of all four reference sources.
--
-- object_name is nullable on purpose: a token the resolver can't attribute to a
-- tracked object is kept for audit but excluded from counts, matching
-- stg_sf_field_reference.sql.
-- ---------------------------------------------------------------------------

create table scan_field_refs (
    id               bigserial primary key,
    scan_id          uuid not null references scans (id) on delete cascade,

    object_name      text,
    field_api_name   text not null,
    reference_type   text not null,
    reference_id     text,
    reference_name   text,
    reference_label  text,
    reference_detail text,
    -- 'dependency_api' | 'report_scan' | 'flexipage_scan' | 'reporttype_scan'
    source           text not null
);

-- Dedupe key from stg_sf_field_reference.sql: the Dependency API and the
-- flexipage scan both see Lightning pages, so the same (field, type, component)
-- can arrive twice. dependency_api wins — see the read-side dedupe in
-- field_references_deduped below.
create index scan_field_refs_lookup_idx
    on scan_field_refs (scan_id, object_name, field_api_name);
create index scan_field_refs_dedupe_idx
    on scan_field_refs (scan_id, object_name, field_api_name, reference_type,
                        coalesce(reference_name, reference_id));

-- ---------------------------------------------------------------------------
-- field_references_deduped — port of stg_sf_field_reference.sql
-- ---------------------------------------------------------------------------

create view field_references_deduped as
select scan_id, object_name, field_api_name, reference_type, reference_id,
       reference_name, reference_label, reference_detail, source
from (
    select *,
           row_number() over (
               partition by scan_id, object_name, field_api_name, reference_type,
                            coalesce(reference_name, reference_id)
               -- Prefer the Dependency API's version of a duplicate: it carries the
               -- component Id, where the regex-based scans only recover a name.
               order by case when source = 'dependency_api' then 0 else 1 end, id
           ) as rn
    from scan_field_refs
    where object_name is not null
) t
where rn = 1;

-- ---------------------------------------------------------------------------
-- field_census — port of dbt marts/field_census/fct_field_census.sql
--
-- BigQuery -> Postgres differences are mechanical:
--   timestamp_sub(current_timestamp(), interval 90 day) -> now() - interval '90 days'
--   round(x * 100, 1)                                   -> round((x * 100)::numeric, 1)
-- ---------------------------------------------------------------------------

create view field_census as
with refs as (
    select scan_id, object_name, field_api_name, count(*) as dependency_count
    from field_references_deduped
    group by 1, 2, 3
),
-- is_reference_tracked in production means "this object was in the reference
-- scanner's scope", guarding against presenting a field as deletable on missing
-- evidence. Here every object is always in scope, so the equivalent guard is
-- temporal rather than spatial: have the reference phases actually finished for
-- this scan yet? Until they have, dependency_count stays NULL ("not scanned"),
-- never 0 ("verified none") — which is what drives the pending state in the UI.
--
-- A failed source counts as finished: the report then shows a real number plus
-- the coverage banner, exactly as production does. Holding every count at NULL
-- because one source 403'd would be less informative, not more honest.
refs_ready as (
    select scan_id,
           bool_and(status in ('complete', 'failed', 'skipped')) as ready
    from scan_phases
    where phase in ('dependencies_mcd', 'flexipages', 'reports', 'report_types')
    group by 1
)
select
    f.scan_id,
    f.object_name,
    f.field_api_name,
    f.field_id,
    f.field_label,
    f.sf_type,
    f.namespace_prefix,
    case
        when not f.is_custom               then 'Standard'
        when f.namespace_prefix is not null then 'Managed Package'
        else                                    'Custom'
    end                                                as namespace_category,
    f.is_custom,
    f.is_deprecated_label,
    f.last_modified_date,
    f.populated_count,
    f.total_records,
    round((f.population_pct * 100)::numeric, 1)        as population_pct,
    case
        -- No measurement: the object has zero records, or the field is not
        -- aggregatable (compound address/name), so SOQL COUNT can't assess it.
        -- Not 'Healthy' (no evidence it's used) and not 'Dead' (no evidence it
        -- isn't) — surfaced honestly as its own state.
        when f.population_pct is null then 'No Data'
        when f.population_pct < 0.01  then 'Dead'
        when f.population_pct < 0.10  then 'Low'
        when f.population_pct < 0.80  then 'Partial'
        else                               'Healthy'
    end                                                as bucket,
    f.on_layout,
    coalesce(rr.ready, false)                          as is_reference_tracked,
    case
        when f.is_custom and coalesce(rr.ready, false)
            then coalesce(r.dependency_count, 0)
    end                                                as dependency_count,
    -- Deliberately simple: dead + unchanged 90 days. Anything else that makes a
    -- field risky to delete (formulas, layouts, reports, Apex, …) shows up in
    -- dependency_count — "Ready · 0 deps" is the zero-friction subset, computed
    -- at read time. This predicate does NOT subtract dependencies.
    --
    -- coalesce(..., false) is load-bearing. population_pct is NULL for every
    -- 'No Data' field, and `NULL < 0.01` is NULL, so without it the column is
    -- three-valued: `count(*) filter (where is_safe_to_delete)` happens to do
    -- the right thing with NULL, but `where not is_safe_to_delete` would
    -- silently drop those rows. Unmeasured is a definite NO, not an unknown.
    coalesce(
        f.is_custom
        and f.namespace_prefix is null
        -- Requires a real measurement below 1%. NULL ('No Data') is not evidence
        -- of disuse and must never flag a field as safe to delete.
        and f.population_pct < 0.01
        and f.last_modified_date is not null
        and f.last_modified_date < now() - interval '90 days',
        false
    )                                                  as is_safe_to_delete
from scan_fields f
left join refs r
    on  r.scan_id = f.scan_id
    and r.object_name = f.object_name
    and r.field_api_name = f.field_api_name
left join refs_ready rr
    on rr.scan_id = f.scan_id;

-- ---------------------------------------------------------------------------
-- RLS: deny everything to anon/authenticated.
--
-- No client ever reads these tables directly. Reports are rendered server-side
-- through the service role after the request's scan token is verified, and live
-- progress arrives over a Realtime broadcast channel keyed by that same token.
-- That keeps report access tied to the unguessable token rather than to a
-- database policy, and keeps the anon key useless if it leaks.
-- ---------------------------------------------------------------------------

alter table scans           enable row level security;
alter table leads           enable row level security;
alter table scan_phases     enable row level security;
alter table scan_fields     enable row level security;
alter table scan_field_refs enable row level security;

-- ---------------------------------------------------------------------------
-- Retention: drop scan payloads after 30 days. Wire to pg_cron in Supabase, or
-- call from the reaper route.
-- ---------------------------------------------------------------------------

create or replace function purge_expired_scans() returns integer
language plpgsql
as $$
declare
    purged integer;
begin
    -- Cascades to phases, fields, refs. The lead row is kept deliberately: the
    -- scan payload is the customer's data and expires, the fact that they made
    -- contact is ours and doesn't.
    with gone as (
        delete from scans where expires_at < now() returning 1
    )
    select count(*) into purged from gone;
    return purged;
end;
$$;
