# Chatbot module (עוזר נהלים)

An AI assistant for the dental clinic network's managers and branch staff. It answers questions
about work procedures, price lists, insurance companies and the Ministry of Defense **only** from
documents the admin uploads, shows which document each answer came from, and never handles
patient details. Spec: the "אפיון מודול צ'אט בוט AI" doc.

## How it works

- **Who:** anyone who passes Cloudflare Access at `bot.shinaim.net`. There is no separate login:
  the app verifies the Access token on every request and identifies people by that email.
  Admins are listed in `BOOTSTRAP_ADMIN_EMAILS` (or in the `chatbot.roles` table).
- **Privacy:** every user confirms the privacy notice once. Messages that contain an ID number,
  a phone number or another long number are blocked before they are stored or sent to Claude
  (`src/lib/privacy.ts`); only who/when/why is logged. The bot refuses patient and medical
  questions.
- **Knowledge:** procedures (PDF, Word, text) are turned into text when uploaded (PDFs are read
  by Claude, which handles tables and text in images); the admin checks and can edit the text
  before saving. Price lists (Excel) become rows: SKU, description, price, per payer, with or
  without VAT. Uploading a new version replaces the old one.
- **Answers:** Claude (`ANTHROPIC_MODEL`, default Claude Sonnet 5.5) gets all procedure texts
  (cached between questions) plus two tools: `lookup_price` (search the price rows) and
  `calculate` (totals and VAT, computed in code). Each answer lists its source documents.
- **Admin screens:** `/admin/documents` (upload, replace, delete) and `/admin/usage`
  (questions, unanswered, "not helpful", privacy blocks and estimated cost, last 30 days).

Stage 3 (routing unanswered questions to topic owners by email, and approving their answers into
the knowledge base) is not built yet; `chatbot.topics` already has owner fields for it.

## Setup

### 1. Database (shared Supabase project)

The tables live in the **dental-branch-directory** Supabase project, in a separate schema
`chatbot`, reached by a restricted role `chatbot_app` that cannot see anything else. The schema
is defined in that repository (`supabase/migrations/*_chatbot_schema.sql`) and deployed by its
workflow.

1. Merge the chatbot schema pull request in `sofiagrig/dental-branch-directory`.
2. In Supabase → SQL Editor, give the role a password (a long random one; don't save it in git):
   ```sql
   alter role chatbot_app with login password '<long random password>';
   ```
3. Supabase → Connect → Transaction pooler: copy the connection string, change the user to
   `chatbot_app.<project-ref>` and put in the password above. That is `CHATBOT_DATABASE_URL`.

### 2. Claude API key

Claude Console → API keys → create a key for this module. It goes only into Vercel's
environment variables (`ANTHROPIC_API_KEY`), never into the code or a chat.

### 3. Vercel

Import this repository into the business Vercel account and set the variables from
`.env.example`: `CHATBOT_DATABASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CANONICAL_HOST=bot.shinaim.net`,
`BOOTSTRAP_ADMIN_EMAILS`, `VAT_RATE`. Add the domain `bot.shinaim.net` to the project.

### 4. Cloudflare

Same setup as `branches.shinaim.net`:

1. DNS: `bot` CNAME to Vercel, proxied.
2. Zero Trust → Access → Applications: an application for `bot.shinaim.net` with the same
   policy as the branches site (email one-time code), plus a bypass application for
   `bot.shinaim.net/.well-known/acme-challenge` so Vercel can renew the certificate.
3. Copy the application's **Audience (AUD) tag** to `CF_ACCESS_AUD`, and the team domain
   (`<team>.cloudflareaccess.com`) to `CF_ACCESS_TEAM_DOMAIN`.

Until `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are set, every page answers "no access".
Preview deployments (`*.vercel.app`) are not behind Access, so they show "no access" too; test on
`bot.shinaim.net`.

## Development

```bash
npm install
cp .env.example .env.local   # set CHATBOT_DATABASE_URL, ANTHROPIC_API_KEY, DEV_USER_EMAIL
npm run dev
```

`DEV_USER_EMAIL` stands in for Cloudflare Access in `npm run dev` only. For a local database,
run the dental-branch-directory migrations on a local Postgres (its `scripts/test-db.sh` does)
and `alter role chatbot_app with login password 'dev'`.

Before committing:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Project layout

```
src/app/page.tsx          chat (privacy confirmation on first visit)
src/app/actions.ts        chat, feedback, privacy server actions
src/app/admin/            documents and usage screens, upload/save actions
src/components/           chat, admin upload panel, layout
src/lib/auth.ts           Cloudflare Access token check, roles
src/lib/privacy.ts        patient-identifier detection
src/lib/claude.ts         prompt, tools, PDF reading
src/lib/knowledge.ts      documents, price search, totals
src/lib/prices.ts         Excel price-list parsing, VAT totals
src/i18n/he.json          all Hebrew UI strings
tests/                    unit tests (node --test)
```
