"use server";

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { revalidatePath } from "next/cache";
import { parseAnswer } from "@/lib/answer";
import { requireUser } from "@/lib/auth";
import { answer, model } from "@/lib/claude";
import { db } from "@/lib/db";
import { documentsByIds } from "@/lib/knowledge";
import { detectIdentifiers, PRIVACY_NOTICE_VERSION, type PrivacyReason } from "@/lib/privacy";
import { describeError } from "@/lib/errors";

const MAX_QUESTION = 2000;
const HISTORY_MESSAGES = 12;

export type Source = { id: string; title: string; updatedAt: string };
export type ChatReply =
  | { ok: true; conversationId: string; message: { id: string; content: string; sources: Source[]; noAnswer: boolean } }
  | { ok: false; error: "blocked"; reasons: PrivacyReason[] }
  | { ok: false; error: "too_long" | "not_acknowledged" | "failed" };

async function hasAcknowledged(email: string): Promise<boolean> {
  const [row] = await db()`
    select 1 from chatbot.privacy_acks where email = ${email} and version = ${PRIVACY_NOTICE_VERSION}`;
  return Boolean(row);
}

export async function acknowledgePrivacy(): Promise<void> {
  const user = await requireUser();
  await db()`
    insert into chatbot.privacy_acks (email, version) values (${user.email}, ${PRIVACY_NOTICE_VERSION})
    on conflict do nothing`;
  revalidatePath("/");
}

const REASONS: readonly PrivacyReason[] = ["israeli_id", "phone", "long_number"];

/** The browser blocked a message before sending it; log who/when/why (never the text). */
export async function recordBlocked(reasons: PrivacyReason[]): Promise<void> {
  const user = await requireUser();
  const valid = [...new Set(reasons)].filter((r) => REASONS.includes(r));
  if (valid.length) await db()`insert into chatbot.privacy_blocks (email, reasons) values (${user.email}, ${valid})`;
}

export async function sendMessage(conversationId: string | null, question: string): Promise<ChatReply> {
  const user = await requireUser();
  const text = question.trim();
  if (!text || text.length > MAX_QUESTION) return { ok: false, error: "too_long" };
  if (!(await hasAcknowledged(user.email))) return { ok: false, error: "not_acknowledged" };

  // The privacy filter runs before anything is stored or sent to the AI. A blocked message is
  // logged without its text.
  const reasons = detectIdentifiers(text);
  if (reasons.length) {
    await db()`insert into chatbot.privacy_blocks (email, reasons) values (${user.email}, ${reasons})`;
    return { ok: false, error: "blocked", reasons };
  }

  const sql = db();
  let convId = conversationId;
  if (convId) {
    const [own] = await sql`select 1 from chatbot.conversations where id = ${convId} and email = ${user.email}`;
    if (!own) convId = null;
  }
  if (!convId) {
    const [created] = await sql<{ id: string }[]>`
      insert into chatbot.conversations (email) values (${user.email}) returning id`;
    convId = created.id;
  }

  const previous = await sql<{ role: "user" | "assistant"; content: string }[]>`
    select role, content from (
      select role, content, created_at from chatbot.messages
      where conversation_id = ${convId} order by created_at desc limit ${HISTORY_MESSAGES}
    ) m order by created_at`;

  const history: MessageParam[] = [...previous, { role: "user" as const, content: text }];
  // The API needs the conversation to start with the user and alternate roles.
  while (history.length && history[0].role !== "user") history.shift();

  try {
    const { text: raw, usage } = await answer(history);
    const parsed = parseAnswer(raw);
    const docs = await documentsByIds(parsed.sourceIds);
    const sources: Source[] = docs.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updated_at.toISOString() }));
    // The question is stored together with its answer, so a failed attempt leaves no
    // half-finished turn in the history.
    const saved = await sql.begin(async (tx) => {
      await tx`insert into chatbot.messages (conversation_id, role, content) values (${convId}, 'user', ${text})`;
      const [row] = await tx<{ id: string }[]>`
        insert into chatbot.messages (conversation_id, role, content, sources, no_answer, model, usage)
        values (${convId}, 'assistant', ${parsed.content}, ${tx.json(sources)}, ${parsed.noAnswer}, ${model()}, ${tx.json(usage)})
        returning id`;
      await tx`update chatbot.conversations set updated_at = now() where id = ${convId}`;
      return row;
    });
    return {
      ok: true,
      conversationId: convId,
      message: { id: saved.id, content: parsed.content, sources, noAnswer: parsed.noAnswer },
    };
  } catch (error) {
    console.error(`chat failed: ${describeError(error)}`);
    return { ok: false, error: "failed" };
  }
}

export async function setFeedback(messageId: string, value: 1 | -1): Promise<boolean> {
  const user = await requireUser();
  if (value !== 1 && value !== -1) return false;
  const rows = await db()`
    update chatbot.messages m set feedback = ${value}
    from chatbot.conversations c
    where m.id = ${messageId} and m.role = 'assistant' and c.id = m.conversation_id and c.email = ${user.email}
    returning m.id`;
  return rows.length === 1;
}
