import type { Metadata } from "next";
import { t } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: t("app.module"),
  description: t("app.name"),
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
