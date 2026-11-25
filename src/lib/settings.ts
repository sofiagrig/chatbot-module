import "server-only";
import { db } from "./db";

// Settings the admins change from the admin screens (chatbot.settings).

/** Longest answer style the database accepts. */
export const ANSWER_STYLE_MAX = 4000;

export type AnswerStyle = { value: string; updatedBy: string; updatedAt: Date };

/** Free-text instructions on tone, length and format, or null when none were written. */
export async function getAnswerStyle(): Promise<AnswerStyle | null> {
  const [row] = await db()<{ value: string; updated_by: string; updated_at: Date }[]>`
    select value, updated_by, updated_at from chatbot.settings where key = 'answer_style'`;
  if (!row || !row.value.trim()) return null;
  return { value: row.value, updatedBy: row.updated_by, updatedAt: row.updated_at };
}
