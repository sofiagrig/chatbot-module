import "server-only";
import postgres from "postgres";

// One small pool per server instance. The app connects as chatbot_app, a role that can use
// the chatbot schema only (see dental-branch-directory: *_chatbot_schema.sql).
// The Supabase transaction pooler does not support prepared statements, hence prepare: false.

declare global {
  var chatbotSql: postgres.Sql | undefined;
}

function connect(): postgres.Sql {
  const url = process.env.CHATBOT_DATABASE_URL?.trim();
  if (!url) throw new Error("Missing CHATBOT_DATABASE_URL (see .env.example)");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : "require",
    // Numeric prices arrive as strings unless parsed.
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (v: number) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  });
}

export function db(): postgres.Sql {
  globalThis.chatbotSql ??= connect();
  return globalThis.chatbotSql;
}
