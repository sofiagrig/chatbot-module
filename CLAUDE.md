# Working on this repository

AI chatbot ("עוזר נהלים") for the dental clinic network: staff ask questions, the bot answers
only from documents an admin uploads (procedures, price lists). See README.md.

- Code, identifiers, comments, commits and docs are in **English**.
- Everything a user sees is **Hebrew, right-to-left**. Never hard-code Hebrew in components:
  add the string to `src/i18n/he.json` and use `t("key")` / `tDynamic(...)`.
- **Database schema lives in the other repo**: `sofiagrig/dental-branch-directory`,
  `supabase/migrations/*_chatbot_schema.sql` (schema `chatbot`, role `chatbot_app`). Both apps
  share one Supabase project, and only that repo pushes migrations. Change the schema there,
  with a test in its `db-tests/chatbot_test.sql`.
- The app connects as `chatbot_app` (postgres.js, `src/lib/db.ts`). Always schema-qualify
  tables (`chatbot.documents`). Never ask for broader database rights.
- **Identity** is the Cloudflare Access token, verified on every request (`src/lib/auth.ts`).
  Every page and server action starts with `getUser()` / `requireUser()` / `requireAdmin()`.
- **Patient data never goes in**: user messages pass `detectIdentifiers()` (`src/lib/privacy.ts`)
  in the browser and again on the server before anything is stored or sent to Claude. Blocked
  messages are logged without their text. Keep it that way.
- Prices and totals come from the database (`lookup_price`, `calculate` tools), never from the
  model's own arithmetic.
- Before committing: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Next.js 16: `middleware` is now `src/proxy.ts`; `params` / `searchParams` / `cookies()` are async.
  Docs ship in `node_modules/next/dist/docs/`.
