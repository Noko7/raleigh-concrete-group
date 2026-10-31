-- Undo the Repair Agreement wording fix: the template points back at version 1 and version 2 is removed, only if
-- version 2 is still the newest (nobody has saved a version 3 on top of it). Agreements drafted from version 2 keep
-- their own copy of its wording.

set local lock_timeout = '5s';

do $$
declare t uuid; v1 uuid;
begin
  select id into t from public.document_templates where name = 'Repair Agreement' limit 1;
  if t is null then return; end if;
  if exists (select 1 from public.document_template_versions where template_id = t and version_no > 2) then
    raise exception 'the Repair template has versions after 2; restore an earlier version from the Templates page instead';
  end if;
  select id into v1 from public.document_template_versions where template_id = t and version_no = 1;
  update public.document_templates set current_version_id = v1, updated_at = now() where id = t;
  delete from public.document_template_versions where template_id = t and version_no = 2 and note = 'Limited Workmanship Warranty added; repair limitations and authorization now point to it';
end $$;
