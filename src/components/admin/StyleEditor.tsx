"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAnswerStyle } from "@/app/admin/actions";
import { t, tDynamic } from "@/i18n";

/** Text box for the answer-style instructions, with save and a saved/error message. */
export function StyleEditor({ initial, updated, max }: { initial: string; updated: string | null; max: number }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = value.trim() !== initial.trim();

  function save() {
    setMessage(null);
    start(async () => {
      try {
        const result = await saveAnswerStyle(value);
        if (result.ok) {
          setMessage({ kind: "ok", text: value.trim() ? t("style.saved") : t("style.cleared") });
          router.refresh();
        } else if (result.error === "pii") {
          setMessage({
            kind: "error",
            text: t("style.pii", { reasons: result.reasons.map((r) => tDynamic(`reasons.${r}`)).join(", ") }),
          });
        } else {
          setMessage({ kind: "error", text: t(result.error === "tooLong" ? "style.tooLong" : "upload.failed", { max }) });
        }
      } catch {
        setMessage({ kind: "error", text: t("upload.failed") });
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <label htmlFor="answer-style" className="font-semibold">
        {t("style.label")}
      </label>
      <textarea
        id="answer-style"
        dir="auto"
        rows={12}
        maxLength={max}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("style.placeholder")}
        className="rounded-lg border border-field bg-surface px-3 py-2 leading-relaxed focus:border-brand"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={save}
          disabled={pending || !changed}
          className="min-h-9 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-50"
        >
          {pending ? t("style.saving") : t("style.save")}
        </button>
        <span className="text-muted">{t("style.count", { count: value.length, max })}</span>
        {message && (
          <span role="status" className={message.kind === "ok" ? "text-ok" : "text-danger"}>
            {message.text}
          </span>
        )}
      </div>
      {updated && <p className="text-xs text-muted">{updated}</p>}
    </section>
  );
}
