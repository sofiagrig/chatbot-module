"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { recordBlocked, sendMessage, setFeedback, type Source } from "@/app/actions";
import { t, tDynamic } from "@/i18n";
import { detectIdentifiers, type PrivacyReason } from "@/lib/privacy";
import { Markdown } from "./Markdown";

type Message =
  | { key: string; role: "user"; content: string }
  | {
      key: string;
      role: "assistant";
      id: string;
      content: string;
      sources: Source[];
      noAnswer: boolean;
      feedback?: 1 | -1;
    };

type Notice = { kind: "blocked"; reasons: PrivacyReason[] } | { kind: "error"; text: string } | null;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });

export function Chat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  function submit(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    if (question.length > 2000) return setNotice({ kind: "error", text: t("chat.tooLong") });
    // Checked here for an instant answer; the server checks again before storing anything.
    const reasons = detectIdentifiers(question);
    if (reasons.length) {
      void recordBlocked(reasons);
      return setNotice({ kind: "blocked", reasons });
    }

    setNotice(null);
    setInput("");
    setMessages((m) => [...m, { key: crypto.randomUUID(), role: "user", content: question }]);
    start(async () => {
      const reply = await sendMessage(conversationId, question);
      if (reply.ok) {
        setConversationId(reply.conversationId);
        setMessages((m) => [...m, { key: reply.message.id, role: "assistant", ...reply.message }]);
        return;
      }
      if (reply.error === "blocked") setNotice({ kind: "blocked", reasons: reply.reasons });
      else if (reply.error === "too_long") setNotice({ kind: "error", text: t("chat.tooLong") });
      else if (reply.error === "not_acknowledged") window.location.reload();
      else setNotice({ kind: "error", text: t("chat.error") });
      // The question did not go through: put it back for editing.
      setMessages((m) => m.slice(0, -1));
      setInput(question);
    });
  }

  function rate(messageId: string, value: 1 | -1) {
    setMessages((m) => m.map((x) => (x.role === "assistant" && x.id === messageId ? { ...x, feedback: value } : x)));
    void setFeedback(messageId, value);
  }

  function reset() {
    setConversationId(null);
    setMessages([]);
    setNotice(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="rounded-lg border border-warn-strong/40 bg-warn-soft px-4 py-3 text-sm leading-6 text-warn">
        {t("privacy.notice")}
      </p>

      <div className="flex flex-1 flex-col gap-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 py-6">
            <h1 className="text-xl font-bold">{t("chat.emptyTitle")}</h1>
            <div className="flex flex-wrap gap-2">
              {(["chat.example1", "chat.example2", "chat.example3"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => submit(t(key))}
                  className="rounded-full border border-line bg-surface px-4 py-2 text-start text-sm hover:border-brand"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.key} className="max-w-[85%] self-start whitespace-pre-wrap rounded-2xl bg-brand-soft px-4 py-3">
              {m.content}
            </div>
          ) : (
            <article key={m.key} className="flex max-w-[95%] flex-col gap-3 self-end rounded-2xl border border-line bg-surface px-4 py-3">
              <Markdown text={m.content} />
              {m.noAnswer && <p className="text-sm text-muted">{t("chat.noAnswer")}</p>}
              {m.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{t("chat.sources")}</span>
                  {m.sources.map((s) => (
                    <span key={s.id} className="rounded-md bg-line-soft px-2 py-0.5">
                      {s.title} · {t("chat.updated", { date: formatDate(s.updatedAt) })}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                {m.feedback ? (
                  <span className="text-muted">{t("chat.thanks")}</span>
                ) : (
                  <>
                    <button type="button" onClick={() => rate(m.id, 1)} className="rounded-md border border-line px-3 py-1 hover:border-ok">
                      {t("chat.helpful")}
                    </button>
                    <button type="button" onClick={() => rate(m.id, -1)} className="rounded-md border border-line px-3 py-1 hover:border-danger">
                      {t("chat.notHelpful")}
                    </button>
                  </>
                )}
              </div>
            </article>
          ),
        )}

        {pending && <p className="self-end text-sm text-muted">{t("chat.thinking")}</p>}
        <div ref={endRef} />
      </div>

      {notice && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          {notice.kind === "blocked" ? (
            <>
              <strong className="block">{t("chat.blockedTitle")}</strong>
              {t("chat.blockedBody", { reasons: notice.reasons.map((r) => tDynamic(`reasons.${r}`)).join(", ") })}
            </>
          ) : (
            notice.text
          )}
        </div>
      )}

      <form
        className="sticky bottom-0 flex items-end gap-2 bg-canvas pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(input);
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
          className="min-h-12 flex-1 resize-y rounded-xl border border-field bg-surface px-4 py-3 focus:border-brand"
        />
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="min-h-11 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50"
          >
            {t("chat.send")}
          </button>
          {messages.length > 0 && (
            <button type="button" onClick={reset} disabled={pending} className="text-sm text-brand">
              {t("chat.newConversation")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
