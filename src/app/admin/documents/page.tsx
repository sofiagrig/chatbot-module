import { AppShell, NoAccess } from "@/components/AppShell";
import { DocumentsManager } from "@/components/admin/DocumentsManager";
import { t } from "@/i18n";
import { getUser } from "@/lib/auth";
import { listDocuments, listTopics } from "@/lib/knowledge";

// Reading a PDF with Claude can take a minute or two.
export const maxDuration = 300;

export default async function DocumentsPage() {
  const user = await getUser();
  if (!user) return <NoAccess />;
  if (user.role !== "admin") return <NoAccess message={t("adminOnly")} />;

  const [documents, topics] = await Promise.all([listDocuments(), listTopics()]);

  return (
    <AppShell user={user}>
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("documents.title")}</h1>
        <p className="text-muted">{t("documents.description")}</p>
      </header>
      <DocumentsManager
        documents={documents.map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          topic: d.topic,
          payer: d.payer,
          vatIncluded: d.vat_included,
          updatedAt: d.updated_at.toISOString(),
          uploadedBy: d.uploaded_by,
          itemCount: d.item_count,
          fileName: d.file_name,
        }))}
        topics={topics.map((x) => x.name)}
      />
    </AppShell>
  );
}
