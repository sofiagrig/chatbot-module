"use client";

import { useState } from "react";
import {
  finishUpload,
  previewPriceList,
  previewProcedure,
  savePriceList,
  saveProcedure,
  startUpload,
  uploadChunk,
} from "@/app/admin/actions";
import { t, tDynamic, type MessageKey } from "@/i18n";
import type { ParseResult } from "@/lib/prices";
import type { PrivacyReason } from "@/lib/privacy";

export type ReplaceTarget = {
  id: string;
  title: string;
  topic: string;
  payer: string | null;
  vatIncluded: boolean | null;
};

const CHUNK = 3 * 1024 * 1024;

type Step =
  | { name: "form" }
  | { name: "uploading"; percent: number }
  | { name: "reading" }
  | { name: "procedure"; fileId: string; text: string; reasons: PrivacyReason[] }
  | { name: "priceList"; fileId: string; result: ParseResult }
  | { name: "saving"; previous: Step };

/** Upload -> preview -> save, for a new document or a new version of an existing one. */
export function UploadPanel({
  kind,
  replace,
  topics,
  onDone,
  onCancel,
}: {
  kind: "procedure" | "price_list";
  replace: ReplaceTarget | null;
  topics: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [topic, setTopic] = useState(replace?.topic ?? "");
  const [title, setTitle] = useState(replace?.title ?? "");
  const [payer, setPayer] = useState(replace?.payer ?? "");
  const [vatIncluded, setVatIncluded] = useState(replace?.vatIncluded ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ name: "form" });
  const [error, setError] = useState<MessageKey | null>(null);
  const [piiChecked, setPiiChecked] = useState(false);

  const busy = step.name === "uploading" || step.name === "reading" || step.name === "saving";

  async function upload() {
    setError(null);
    if (!topic.trim() || !title.trim() || !file || (kind === "price_list" && !payer.trim())) {
      return setError("upload.missingFields");
    }
    // Show progress right away: a server action can wait behind an earlier one (e.g. a PDF
    // still being read after "cancel"), and silence looks like a dead button.
    setStep({ name: "uploading", percent: 0 });
    const fail = (key: MessageKey) => {
      setStep({ name: "form" });
      setError(key);
    };
    try {
      const started = await startUpload(file.name, file.size, kind);
      if (!started.ok) return fail(`upload.${started.error}`);
      const count = Math.ceil(file.size / CHUNK);
      for (let i = 0; i < count; i++) {
        setStep({ name: "uploading", percent: Math.round((i / count) * 100) });
        const form = new FormData();
        form.set("fileId", started.fileId);
        form.set("idx", String(i));
        form.set("chunk", file.slice(i * CHUNK, (i + 1) * CHUNK));
        if (!(await uploadChunk(form))) return fail("upload.failed");
      }
      if (!(await finishUpload(started.fileId))) return fail("upload.failed");
      setStep({ name: "reading" });
      if (kind === "procedure") {
        const preview = await previewProcedure(started.fileId);
        if (!preview.ok) return fail(`upload.${preview.error}`);
        setPiiChecked(preview.reasons.length === 0);
        setStep({ name: "procedure", fileId: started.fileId, text: preview.text, reasons: preview.reasons });
      } else {
        const preview = await previewPriceList(started.fileId);
        if (!preview.ok) return fail(`upload.${preview.error}`);
        setStep({ name: "priceList", fileId: started.fileId, result: preview.result });
      }
    } catch (e) {
      // A server action that throws (connection error, timeout) must not leave the panel stuck.
      console.error(e);
      fail("upload.failed");
    }
  }

  async function save() {
    if (step.name !== "procedure" && step.name !== "priceList") return;
    setError(null);
    setStep({ name: "saving", previous: step });
    let result: Awaited<ReturnType<typeof saveProcedure>>;
    try {
      result =
        step.name === "procedure"
          ? await saveProcedure({ documentId: replace?.id ?? null, topic, title, content: step.text, fileId: step.fileId })
          : await savePriceList({ documentId: replace?.id ?? null, topic, title, payer, vatIncluded, fileId: step.fileId });
    } catch (e) {
      console.error(e);
      result = { ok: false, error: "failed" };
    }
    if (result.ok) return onDone();
    setStep(step);
    setError(result.error === "rowErrors" ? "upload.rowErrors" : `upload.${result.error}`);
  }

  const field = "min-h-10 rounded-lg border border-field bg-surface px-3 focus:border-brand";
  const current = step.name === "saving" ? step.previous : step;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-brand/40 bg-surface p-5">
      <h2 className="text-lg font-bold">
        {replace
          ? t("upload.replacing", { title: replace.title })
          : t(kind === "procedure" ? "upload.newProcedure" : "upload.newPriceList")}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("upload.topic")}
          <input list="topics" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={current.name !== "form"} className={field} />
          <span className="text-xs font-normal text-muted">{t("upload.topicHint")}</span>
          <datalist id="topics">
            {topics.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("upload.title")}
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={current.name !== "form"} className={field} />
        </label>
        {kind === "price_list" && (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t("upload.payer")}
              <input value={payer} onChange={(e) => setPayer(e.target.value)} disabled={current.name !== "form"} className={field} />
              <span className="text-xs font-normal text-muted">{t("upload.payerHint")}</span>
            </label>
            <label className="flex items-center gap-2 self-center text-sm font-medium">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={vatIncluded}
                onChange={(e) => setVatIncluded(e.target.checked)}
                disabled={current.name !== "form"}
              />
              {t("upload.vat")}
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          {t("upload.file")}
          <input
            type="file"
            accept={kind === "procedure" ? ".pdf,.docx,.txt,.md" : ".xlsx"}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={current.name !== "form"}
          />
          <span className="text-xs font-normal text-muted">
            {t(kind === "procedure" ? "upload.procedureFileHint" : "upload.priceFileHint")}
          </span>
        </label>
      </div>

      {step.name === "uploading" && <p className="text-sm text-muted">{t("upload.uploading", { percent: step.percent })}</p>}
      {step.name === "reading" && <p className="text-sm text-muted">{t("upload.reading")}</p>}

      {current.name === "procedure" && (
        <div className="flex flex-col gap-2">
          <h3 className="font-bold">{t("upload.preview")}</h3>
          <p className="text-sm text-muted">{t("upload.previewHint")}</p>
          {current.reasons.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-warn-strong/40 bg-warn-soft px-4 py-3 text-sm text-warn">
              <p>{t("upload.piiWarning", { reasons: current.reasons.map((r) => tDynamic(`reasons.${r}`)).join(", ") })}</p>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" className="size-4" checked={piiChecked} onChange={(e) => setPiiChecked(e.target.checked)} />
                {t("upload.piiConfirm")}
              </label>
            </div>
          )}
          <textarea
            value={current.text}
            onChange={(e) => setStep({ ...current, text: e.target.value })}
            disabled={step.name === "saving"}
            rows={18}
            dir="auto"
            className="rounded-lg border border-field p-3 font-mono text-sm leading-6"
          />
        </div>
      )}

      {current.name === "priceList" && <PriceListPreview result={current.result} />}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {current.name === "form" ? (
          <button type="button" onClick={upload} disabled={busy} className="min-h-10 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50">
            {t("upload.next")}
          </button>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={
              busy ||
              (current.name === "procedure" && (!piiChecked || !current.text.trim())) ||
              (current.name === "priceList" &&
                (current.result.noHeader || current.result.errors.length > 0 || current.result.rows.length === 0))
            }
            className="min-h-10 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50"
          >
            {t("upload.save")}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-10 rounded-lg border border-line px-5 font-semibold">
          {t("upload.cancel")}
        </button>
      </div>
    </section>
  );
}

function PriceListPreview({ result }: { result: ParseResult }) {
  if (result.noHeader) return <p className="text-sm text-danger">{t("upload.noHeader")}</p>;
  if (result.errors.length) {
    return (
      <div className="flex flex-col gap-1 text-sm text-danger">
        <p className="font-medium">{t("upload.rowErrors")}</p>
        <ul className="list-disc ps-5">
          {result.errors.slice(0, 20).map((e, i) => (
            <li key={i}>{tDynamic(`upload.errors.${e.code}`, { row: e.row, value: e.value ?? "" })}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (result.rows.length === 0) return <p className="text-sm text-danger">{t("upload.noRows")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{t("upload.rowsFound", { count: result.rows.length })}</p>
      <table className="w-full text-sm">
        <tbody>
          {result.rows.slice(0, 10).map((r) => (
            <tr key={r.sku} className="border-t border-line-soft">
              <td className="px-2 py-1" dir="ltr">{r.sku}</td>
              <td className="px-2 py-1">{r.description}</td>
              <td className="px-2 py-1 whitespace-nowrap" dir="ltr">{r.price.toLocaleString("he-IL")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
