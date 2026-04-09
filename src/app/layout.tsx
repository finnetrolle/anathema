import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anathema",
  description: "Jira timeline analytics grouped by epics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

