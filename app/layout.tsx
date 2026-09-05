import type { Metadata } from "next";
import "./globals.css";
import "./account.css";
import "./react-workspace.css";
import "./themes.css";
import { ThemeToolbar } from "./theme-toolbar";

export const metadata: Metadata = {
  title: "交易復盤顧問",
  description: "私人交易紀錄、持倉計畫、閉環證據與行為復盤工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Tiny same-origin preference script must run before paint to prevent a theme flash.
  // eslint-disable-next-line @next/next/no-sync-scripts
  return <html lang="zh-Hant" suppressHydrationWarning><head><script src="/theme-init.js" /></head><body><ThemeToolbar />{children}</body></html>;
}
