-- Check the Repair Agreement wording fix. One row per check; "(bad)" is a failure.
select 'repair template current version is 2' as check_name,
       case when v.version_no = 2 then 'ok' else '(bad) version ' || v.version_no end as result
  from public.document_templates t join public.document_template_versions v on v.id = t.current_version_id
 where t.name = 'Repair Agreement'
union all
select 'has the Limited Workmanship Warranty section',
       case when exists (select 1 from public.document_templates t join public.document_template_versions v on v.id = t.current_version_id,
                         jsonb_array_elements(v.body->'clauses') c
                          where t.name = 'Repair Agreement' and c->>'title' = 'Limited Workmanship Warranty') then 'ok' else '(bad)' end
union all
select 'no reference to "the Warranty below"',
       case when exists (select 1 from public.document_templates t join public.document_template_versions v on v.id = t.current_version_id
                          where t.name = 'Repair Agreement' and v.body::text like '%the Warranty below%') then '(bad)' else 'ok' end;
