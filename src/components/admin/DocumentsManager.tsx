"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument } from "@/app/admin/actions";
import { t, tDynamic } from "@/i18n";
import { UploadPanel, type ReplaceTarget } from "./UploadPanel";

export type DocumentItem = {
  id: string;
  title: string;
  kind: "procedure" | "price_list" | "qa";
  topic: string;
  payer: string | null;
  vatIncluded: boolean | null;
  updatedAt: string;
  uploadedBy: string;
  itemCount: number;
  fileName: string | null;
};

type Panel = { kind: "procedure" | "price_list"; replace: ReplaceTarget | null } | null;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });

export function DocumentsManager({ documents, topics }: { documents: DocumentItem[]; topics: string[] }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, start] = useTransition();

  const byTopic = new Map<string, DocumentItem[]>();
  for (const d of documents) byTopic.set(d.topic, [...(byTopic.get(d.topic) ?? []), d]);

  function remove(d: DocumentItem) {
    if (!window.confirm(t("documents.confirmDelete", { title: d.title }))) return;
    start(async () => {
      await deleteDocument(d.id);
      router.refresh();
    });
  }

  const button = "min-h-10 rounded-lg px-4 text-sm font-semibold";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPanel({ kind: "procedure", replace: null })} className={`${button} bg-brand text-white`}>
          {t("upload.newProcedure")}
        </button>
        <button type="button" onClick={() => setPanel({ kind: "price_list", replace: null })} className={`${button} bg-brand text-white`}>
          {t("upload.newPriceList")}
        </button>
      </div>

      {panel && (
        <UploadPanel
          key={`${panel.kind}-${panel.replace?.id ?? "new"}`}
          kind={panel.kind}
          replace={panel.replace}
          topics={topics}
          onDone={() => {
            setPanel(null);
            router.refresh();
          }}
          onCancel={() => setPanel(null)}
        />
      )}

      {documents.length === 0 && <p className="text-muted">{t("documents.empty")}</p>}

      {[...byTopic.entries()].map(([topic, docs]) => (
        <section key={topic} className="overflow-hidden rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line bg-line-soft px-4 py-2 font-bold">{topic}</h2>
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("documents.colTitle")}</th>
                <th className="hidden px-4 py-2 text-start font-medium sm:table-cell">{t("documents.colKind")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("documents.colUpdated")}</th>
                <th className="hidden px-4 py-2 text-start font-medium sm:table-cell">{t("documents.colBy")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-line-soft align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.title}</div>
                    {d.kind === "price_list" && (
                      <div className="text-muted">
                        {d.payer} · {d.vatIncluded ? t("documents.vatIncluded") : t("documents.vatExcluded")} ·{" "}
                        {t("documents.rows", { count: d.itemCount })}
                      </div>
                    )}
                    {d.fileName && <div className="text-xs text-muted" dir="auto">{d.fileName}</div>}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">{tDynamic(`documents.kind.${d.kind}`)}</td>
                  <td className="px-4 py-3">{formatDate(d.updatedAt)}</td>
                  <td className="hidden px-4 py-3 sm:table-cell" dir="ltr">{d.uploadedBy}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-2 whitespace-nowrap sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          setPanel({
                            kind: d.kind === "price_list" ? "price_list" : "procedure",
                            replace: { id: d.id, title: d.title, topic: d.topic, payer: d.payer, vatIncluded: d.vatIncluded },
                          })
                        }
                        className="rounded-md border border-line px-3 py-1 hover:border-brand"
                      >
                        {t("documents.replace")}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove(d)}
                        className="rounded-md border border-line px-3 py-1 text-danger hover:border-danger"
                      >
                        {t("documents.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
