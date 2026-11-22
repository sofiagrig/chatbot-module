"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissReview, saveCorrection } from "@/app/admin/actions";
import { t, tDynamic, type MessageKey } from "@/i18n";

/** One answer to review: shows the question and the bot's answer, and lets the admin correct it. */
export function ReviewItem({
  messageId,
  question,
  answer,
  meta,
  topics,
}: {
  messageId: string;
  question: string;
  answer: string;
  meta: string;
  topics: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [fixedQuestion, setFixedQuestion] = useState(question);
  const [fixedAnswer, setFixedAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      try {
        const result = await saveCorrection({ messageId, topic, question: fixedQuestion, answer: fixedAnswer });
        if (result.ok) return router.refresh();
        if (result.error === "pii") {
          setError(t("corrections.pii", { reasons: result.reasons.map((r) => tDynamic(`reasons.${r}`)).join(", ") }));
        } else {
          setError(t(`upload.${result.error}` as MessageKey));
        }
      } catch {
        setError(t("upload.failed"));
      }
    });
  }

  function dismiss() {
    start(async () => {
      try {
        await dismissReview(messageId);
        router.refresh();
      } catch {
        setError(t("upload.failed"));
      }
    });
  }

  const field = "rounded-lg border border-field bg-surface px-3 py-2 focus:border-brand";

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
      <div className="text-muted" dir="auto">
        {meta}
      </div>
      <p className="font-medium">{question}</p>
      <p className="whitespace-pre-wrap text-muted">{answer}</p>

      {!open ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={pending}
            className="min-h-9 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-50"
          >
            {t("corrections.correct")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={pending}
            className="min-h-9 rounded-lg border border-line px-4 font-semibold disabled:opacity-50"
          >
            {t("corrections.dismiss")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3 border-t border-line-soft pt-3">
          <label className="flex flex-col gap-1 font-medium">
            {t("upload.topic")}
            <input list={`topics-${messageId}`} value={topic} onChange={(e) => setTopic(e.target.value)} className={field} />
            <datalist id={`topics-${messageId}`}>
              {topics.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            {t("corrections.question")}
            <span className="text-xs font-normal text-muted">{t("corrections.questionHint")}</span>
            <textarea value={fixedQuestion} onChange={(e) => setFixedQuestion(e.target.value)} rows={2} className={field} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            {t("corrections.answer")}
            <textarea value={fixedAnswer} onChange={(e) => setFixedAnswer(e.target.value)} rows={5} className={field} />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !topic.trim() || !fixedQuestion.trim() || !fixedAnswer.trim()}
              className="min-h-9 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-50"
            >
              {t("corrections.save")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="min-h-9 rounded-lg border border-line px-4 font-semibold"
            >
              {t("upload.cancel")}
            </button>
          </div>
        </div>
      )}
      {!open && error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
