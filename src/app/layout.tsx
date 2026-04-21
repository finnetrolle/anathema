import type { Metadata } from "next";
import "./globals.css";

import { getAppLocale } from "@/modules/i18n/server";

export const metadata: Metadata = {
  title: "Anathema",
  description: "Jira timeline analytics grouped by epics.",
};

const themeScript = `
(function(){
  try {
    var t = localStorage.getItem("theme");
    if (t === "dark" || t === "light") { document.documentElement.setAttribute("data-theme", t); return; }
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch(e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getAppLocale();

  return (
    <html lang={locale}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
