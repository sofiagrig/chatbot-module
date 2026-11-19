"use client";

import { useState, useTransition } from "react";
import { acknowledgePrivacy } from "@/app/actions";
import { t } from "@/i18n";

/** Shown once per notice version: the user must confirm the privacy rule before chatting. */
export function PrivacyGate() {
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();

  return (
    <section className="mx-auto mt-6 flex max-w-xl flex-col gap-4 rounded-xl border border-warn-strong bg-surface p-6">
      <h1 className="text-xl font-bold">{t("privacy.title")}</h1>
      <p className="leading-7">{t("privacy.notice")}</p>
      <label className="flex items-start gap-3 font-medium">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-brand"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {t("privacy.confirm")}
      </label>
      <button
        type="button"
        disabled={!checked || pending}
        onClick={() => start(() => acknowledgePrivacy())}
        className="min-h-11 self-start rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50"
      >
        {t("privacy.start")}
      </button>
    </section>
  );
}
