/**
 * One-line description of an error for the logs. API errors from Claude carry their status and
 * the reason in `message` (e.g. `400 {"type":"error","error":{"message":"..."}}`); logging it as
 * a plain string keeps the reason visible in Vercel's log view instead of a folded object.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return `${error.name}${typeof status === "number" ? ` ${status}` : ""}: ${error.message}`;
  }
  return String(error);
}
