import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atoms Demo · 智能应用生成器",
  description:
    "用一句话描述，AI Agent 分阶段规划、生成、校验并实时预览一个可运行、可交互、数据可持久化的 Web 应用。",
};

export const viewport: Viewport = {
  themeColor: "#08080b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
