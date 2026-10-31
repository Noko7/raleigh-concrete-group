-- Undo PENDING_document_templates.
--
-- Templates and their saved versions are the owner's wording. This refuses to run once any template has a second
-- version or a third template exists (that is, once someone has edited, cloned or created one): dropping the tables
-- would lose that work. Agreements already drafted keep their own copy of the template, so they are not affected.
-- Export first (select * from public.document_template_versions), then, only if you are sure, delete the guard block
-- below and run it again.

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.document_template_versions where version_no > 1)
     or (select count(*) from public.document_templates) > 2 then
    raise exception 'templates have been edited or added; export them before undoing (see the comment at the top)';
  end if;
end $$;

alter table public.document_templates drop constraint if exists document_templates_current_version_fkey;
drop table public.document_template_versions;
drop table public.document_templates;
drop function if exists public.number_template_version();
drop function if exists public.point_template_at_version();
drop function if exists public.guard_template_version();
