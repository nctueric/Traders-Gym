import type { Metadata } from "next";
import "./globals.css";
import "./account.css";
import "./react-workspace.css";

export const metadata: Metadata = {
  title: "交易復盤顧問",
  description: "私人交易紀錄、持倉計畫、閉環證據與行為復盤工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body><div hidden dangerouslySetInnerHTML={{ __html: "<!-- THESIS: Inspect trades without losing the ledger. OWN-WORLD: Graphite, blue selection, green gains/red losses. STORY: Scan, select, inspect and save. FIRST VIEWPORT: Compact navigation, account/save strip, ledger plus right detail. FORM: user-pinned-react-workspace, code-led. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->" }}/>{children}</body></html>;
}
