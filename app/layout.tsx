import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "交易復盤顧問",
  description: "私人交易紀錄、持倉計畫、閉環證據與行為復盤工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
