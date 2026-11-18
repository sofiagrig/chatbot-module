import { AppShell, NoAccess } from "@/components/AppShell";
import { t } from "@/i18n";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Claude Sonnet 5.5 list prices, USD per million tokens (cache writes at 1.25x input).
const PRICE = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };

type Row = { question: string; answer: string; email: string; created_at: Date };

export default async function UsagePage() {
  const user = await getUser();
  if (!user) return <NoAccess />;
  if (user.role !== "admin") return <NoAccess message={t("adminOnly")} />;

  const sql = db();
  const [stats] = await sql<
    { questions: number; users: number; no_answer: number; input: number; output: number; cache_read: number; cache_write: number }[]
  >`
    select count(*)::int as questions,
           count(distinct c.email)::int as users,
           count(*) filter (where m.no_answer)::int as no_answer,
           coalesce(sum((m.usage->>'input')::bigint), 0)::float8 as input,
           coalesce(sum((m.usage->>'output')::bigint), 0)::float8 as output,
           coalesce(sum((m.usage->>'cacheRead')::bigint), 0)::float8 as cache_read,
           coalesce(sum((m.usage->>'cacheWrite')::bigint), 0)::float8 as cache_write
    from chatbot.messages m join chatbot.conversations c on c.id = m.conversation_id
    where m.role = 'assistant' and m.created_at > now() - interval '30 days'`;
  const [blocked] = await sql<{ n: number }[]>`
    select count(*)::int as n from chatbot.privacy_blocks where created_at > now() - interval '30 days'`;

  // Each answer with the question just before it in the same conversation.
  const pairs = (kind: "negative" | "unanswered") => sql<Row[]>`
    select q.content as question, a.content as answer, c.email, a.created_at
    from chatbot.messages a
    join chatbot.conversations c on c.id = a.conversation_id
    cross join lateral (
      select content from chatbot.messages u
      where u.conversation_id = a.conversation_id and u.role = 'user' and u.created_at <= a.created_at
      order by u.created_at desc limit 1
    ) q
    where a.role = 'assistant'
      and (case when ${kind} = 'negative' then a.feedback = -1 else a.no_answer end)
    order by a.created_at desc limit 50`;
  const [negative, unanswered] = await Promise.all([pairs("negative"), pairs("unanswered")]);

  const cost =
    (stats.input * PRICE.input + stats.output * PRICE.output + stats.cache_read * PRICE.cacheRead + stats.cache_write * PRICE.cacheWrite) /
    1_000_000;

  const tiles: [string, string][] = [
    [t("usage.questions"), stats.questions.toLocaleString("he-IL")],
    [t("usage.users"), stats.users.toLocaleString("he-IL")],
    [t("usage.noAnswer"), stats.no_answer.toLocaleString("he-IL")],
    [t("usage.blocked"), blocked.n.toLocaleString("he-IL")],
    [t("usage.cost"), `$${cost.toFixed(2)}`],
  ];

  return (
    <AppShell user={user}>
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("usage.title")}</h1>
        <p className="text-muted">{t("usage.description")}</p>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="text-2xl font-bold" dir="ltr">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t("usage.costNote")}</p>
      <PairList title={t("usage.negative")} rows={negative} />
      <PairList title={t("usage.unanswered")} rows={unanswered} />
    </AppShell>
  );
}

function PairList({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="mt-8 flex flex-col gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {rows.length === 0 && <p className="text-muted">{t("usage.noneYet")}</p>}
      {rows.map((r, i) => (
        <article key={i} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-sm">
          <div className="text-muted">
            <span dir="ltr">{r.email}</span> · {r.created_at.toLocaleString("he-IL")}
          </div>
          <p className="font-medium">{r.question}</p>
          <p className="whitespace-pre-wrap text-muted">{r.answer}</p>
        </article>
      ))}
    </section>
  );
}
