-- Explain WHY a field has no population measurement.
--
-- "No Data" was covering three unrelated situations, which made the most
-- reasonable question a user can ask — "why can't you measure this one?" —
-- unanswerable from the report:
--
--   not_visible      The field exists in FieldDefinition but the sObject
--                    describe never returned it. Usually field-level security
--                    (describe respects FLS, FieldDefinition does not), or an
--                    internal/feature-gated field. Detected by total_records
--                    being NULL: the population phase never wrote this row.
--   not_aggregatable The object was measured, but SOQL COUNT() refuses this
--                    field — compound address fields, long text areas.
--   no_records       The object itself is empty, so there is nothing to measure
--                    and no evidence either way.
--
-- The distinction matters beyond curiosity: a report full of not_visible fields
-- means the connecting user can't see much of their own org, which should lower
-- confidence in the whole scan rather than read as "nothing to clean up".

drop view if exists field_census;

create view field_census
with (security_invoker = true)
as
with refs as (
    select scan_id, object_name, field_api_name, count(*) as dependency_count
    from field_references_deduped
    group by 1, 2, 3
),
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
        when not f.is_custom                then 'Standard'
        when f.namespace_prefix is not null then 'Managed Package'
        else                                     'Custom'
    end                                                as namespace_category,
    f.is_custom,
    f.is_deprecated_label,
    f.last_modified_date,
    f.populated_count,
    f.total_records,
    round((f.population_pct * 100)::numeric, 1)        as population_pct,
    case
        when f.population_pct is null then 'No Data'
        when f.population_pct < 0.01  then 'Dead'
        when f.population_pct < 0.10  then 'Low'
        when f.population_pct < 0.80  then 'Partial'
        else                               'Healthy'
    end                                                as bucket,
    -- NULL whenever the field was actually measured.
    case
        when f.total_records is null   then 'not_visible'
        when f.populated_count is null then 'not_aggregatable'
        when f.total_records = 0       then 'no_records'
    end                                                as no_data_reason,
    f.on_layout,
    coalesce(rr.ready, false)                          as is_reference_tracked,
    case
        when f.is_custom and coalesce(rr.ready, false)
            then coalesce(r.dependency_count, 0)
    end                                                as dependency_count,
    coalesce(
        f.is_custom
        and f.namespace_prefix is null
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

-- Recreating the view drops its grants; restore the service-role-only posture
-- established in 0003.
revoke all on field_census from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant select on field_census to service_role;
    end if;
end
$$;
