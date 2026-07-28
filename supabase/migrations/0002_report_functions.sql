-- Read-side aggregates for the report.
--
-- These are ports of the SQL blocks in
-- canopy-data-jungle/evidence/pages/metadata/field-triage.md. Keeping them as SQL
-- rather than aggregating in TypeScript means the numbers on this report and the
-- numbers on the paid dashboard come from the same expressions, and progressive
-- reveal falls out for free: every call re-reads field_census, which widens as
-- reference rows land.

-- ---------------------------------------------------------------------------
-- Overview KPI tiles — port of the `overview_kpis` block.
-- ---------------------------------------------------------------------------

create or replace function scan_summary(p_scan_id uuid)
returns table (
    objects_scanned integer,
    fields_scanned  integer,
    dead_fields     integer,
    delete_ready    integer,
    ready_no_deps   integer
)
language sql
stable
as $$
    select
        count(distinct object_name)::integer                                    as objects_scanned,
        count(*)::integer                                                       as fields_scanned,
        -- Dead standard fields can't be deleted, so counting them would inflate
        -- the apparent opportunity with rows nobody can act on.
        count(*) filter (
            where bucket = 'Dead' and namespace_category <> 'Standard'
        )::integer                                                              as dead_fields,
        count(*) filter (where is_safe_to_delete)::integer                      as delete_ready,
        count(*) filter (
            where is_safe_to_delete and dependency_count = 0
        )::integer                                                              as ready_no_deps
    from field_census
    where scan_id = p_scan_id;
$$;

-- ---------------------------------------------------------------------------
-- The "By Object" table — port of the `by_object` block.
--
-- Health metrics cover CUSTOM fields only (native + managed): dead standard
-- fields aren't deletable, so including them makes every bar look worse than the
-- actual cleanup opportunity.
-- ---------------------------------------------------------------------------

create or replace function scan_by_object(p_scan_id uuid)
returns table (
    object_name        text,
    total_fields       integer,
    custom_fields      integer,
    standard_fields    integer,
    managed_fields     integer,
    dead_fields        integer,
    low_fields         integer,
    partial_fields     integer,
    healthy_fields     integer,
    no_data_fields     integer,
    delete_ready       integer,
    ready_no_deps      integer,
    total_dependencies integer
)
language sql
stable
as $$
    select
        object_name,
        count(*)::integer,
        count(*) filter (where namespace_category = 'Custom')::integer,
        count(*) filter (where namespace_category = 'Standard')::integer,
        count(*) filter (where namespace_category = 'Managed Package')::integer,
        count(*) filter (where bucket = 'Dead'    and namespace_category <> 'Standard')::integer,
        count(*) filter (where bucket = 'Low'     and namespace_category <> 'Standard')::integer,
        count(*) filter (where bucket = 'Partial' and namespace_category <> 'Standard')::integer,
        count(*) filter (where bucket = 'Healthy' and namespace_category <> 'Standard')::integer,
        count(*) filter (where bucket = 'No Data' and namespace_category <> 'Standard')::integer,
        count(*) filter (where is_safe_to_delete)::integer,
        count(*) filter (where is_safe_to_delete and dependency_count = 0)::integer,
        coalesce(sum(dependency_count), 0)::integer
    from field_census
    where scan_id = p_scan_id
    group by object_name
    order by object_name asc;
$$;

-- ---------------------------------------------------------------------------
-- Reference-type rollup for a single field — powers "Where is this used?".
-- ---------------------------------------------------------------------------

create or replace function field_reference_summary(
    p_scan_id uuid,
    p_object  text,
    p_field   text
)
returns table (reference_type text, ref_count integer)
language sql
stable
as $$
    select reference_type, count(*)::integer
    from field_references_deduped
    where scan_id = p_scan_id
      and lower(object_name) = lower(p_object)
      and lower(field_api_name) = lower(p_field)
    group by reference_type
    order by reference_type asc;
$$;
