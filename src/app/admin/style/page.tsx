import { AppShell, NoAccess } from "@/components/AppShell";
import { StyleEditor } from "@/components/admin/StyleEditor";
import { t } from "@/i18n";
import { getUser } from "@/lib/auth";
import { ANSWER_STYLE_MAX, getAnswerStyle } from "@/lib/settings";

export default async function StylePage() {
  const user = await getUser();
  if (!user) return <NoAccess />;
  if (user.role !== "admin") return <NoAccess message={t("adminOnly")} />;

  const style = await getAnswerStyle();
  const updated = style
    ? t("style.updated", {
        email: style.updatedBy,
        date: style.updatedAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }),
      })
    : null;

  return (
    <AppShell user={user}>
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("style.title")}</h1>
        <p className="text-muted">{t("style.description")}</p>
      </header>
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <StyleEditor initial={style?.value ?? ""} updated={updated} max={ANSWER_STYLE_MAX} />
        <aside className="flex flex-col gap-4 text-sm">
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-semibold">{t("style.examplesTitle")}</h2>
            <ul className="list-disc space-y-1 ps-5 text-muted">
              <li>{t("style.example1")}</li>
              <li>{t("style.example2")}</li>
              <li>{t("style.example3")}</li>
              <li>{t("style.example4")}</li>
            </ul>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-semibold">{t("style.fixedTitle")}</h2>
            <ul className="list-disc space-y-1 ps-5 text-muted">
              <li>{t("style.fixed1")}</li>
              <li>{t("style.fixed2")}</li>
              <li>{t("style.fixed3")}</li>
              <li>{t("style.fixed4")}</li>
            </ul>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
