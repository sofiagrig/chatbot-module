import Link from "next/link";
import { t } from "@/i18n";
import type { User } from "@/lib/auth";

/** Top bar with the module name and navigation; admins also see the management screens. */
export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const link = "rounded-md px-3 py-2 text-sm font-medium text-nav-fg no-underline hover:bg-nav-active hover:text-nav-fg-active";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-nav text-nav-fg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-base font-bold text-nav-fg-active">{t("app.module")}</span>
            <span className="text-xs text-nav-muted">{t("app.name")}</span>
          </div>
          <nav aria-label={t("nav.mainNav")} className="flex flex-wrap gap-1">
            <Link href="/" className={link}>
              {t("nav.chat")}
            </Link>
            {user.role === "admin" && (
              <>
                <Link href="/admin/documents" className={link}>
                  {t("nav.documents")}
                </Link>
                <Link href="/admin/usage" className={link}>
                  {t("nav.usage")}
                </Link>
              </>
            )}
          </nav>
          <span className="ms-auto text-xs text-nav-muted" dir="ltr">
            {user.email}
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">{children}</main>
    </div>
  );
}

export function NoAccess({ message }: { message?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-4">
      <h1 className="text-2xl font-bold">{t("noAccess.title")}</h1>
      <p className="text-muted">{message ?? t("noAccess.body")}</p>
    </main>
  );
}
