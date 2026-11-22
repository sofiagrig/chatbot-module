import "server-only";
import { after } from "next/server";
import postgres from "postgres";
import { cache } from "react";

// Database access as chatbot_app, a role that can use the chatbot schema only
// (see dental-branch-directory: *_chatbot_schema.sql).
//
// One connection per request, closed when the response is done. Vercel freezes a function
// between requests; a connection kept open across a freeze can be dropped by the network
// without either side noticing, and the next query on it then waits until the function's time
// limit (this took the whole site down). A fresh connection per request avoids that.
// The Supabase transaction pooler (Supavisor) does not support prepared statements, hence
// prepare: false. It also mishandles pipelining (several queries sent on one connection before
// the first answers): Postgres is left waiting for the rest of a query that never arrives, and
// the request hangs. max_pipeline: 1 sends one query at a time; Promise.all just waits its turn.

function connect(): postgres.Sql {
  const url = process.env.CHATBOT_DATABASE_URL?.trim();
  if (!url) throw new Error("Missing CHATBOT_DATABASE_URL (see .env.example)");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    prepare: false,
    max: 1,
    max_pipeline: 1,
    idle_timeout: 5,
    connect_timeout: 10,
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

declare global {
  var chatbotSqlOutsideRequest: postgres.Sql | undefined;
}

const forRequest = cache((): postgres.Sql => {
  const sql = connect();
  try {
    after(() => sql.end({ timeout: 5 }));
  } catch (error) {
    void sql.end({ timeout: 0 });
    throw error;
  }
  if (process.env.DB_DEBUG) console.log("db: new connection for request");
  return sql;
});

export function db(): postgres.Sql {
  try {
    return forRequest();
  } catch {
    // Outside a Next.js request (scripts, tests): one shared connection.
    globalThis.chatbotSqlOutsideRequest ??= connect();
    return globalThis.chatbotSqlOutsideRequest;
  }
}
