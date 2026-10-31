import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOwner } from "@/lib/crm/auth";
import { BLANK_TEMPLATE } from "@/lib/crm/template-tools";
import { parseTemplateBody } from "@/lib/crm/agreement-doc";
import { crmBase } from "@/lib/crm/nav";
import { getTemplate, getTemplateVersion, listTemplateVersions } from "@/lib/crm/templates";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

// One agreement template, edited by the owner. Every save is a new, numbered version of it.
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOwner();
  const base = await crmBase();
  const { id } = await params;
  const template = await getTemplate(session, id);
  if (!template) notFound();
  const [versions, current] = await Promise.all([
    listTemplateVersions(session, id),
    template.current_version_id ? getTemplateVersion(session, template.current_version_id) : Promise.resolve(null),
  ]);
  const parsed = current ? parseTemplateBody(current.body) : null;

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-breadcrumb">
        <Link href={`${base}/documents?view=templates`}>← Templates</Link>
      </div>
      <TemplateEditor
        template={{ id: template.id, name: template.name, status: template.status }}
        initial={parsed?.ok ? parsed.body : BLANK_TEMPLATE}
        versions={versions}
      />
    </main>
  );
}
