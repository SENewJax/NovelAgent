import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小说智能工作台",
  description: "上传小说 → 多维度诊断 → 定向优化 → 智能续写",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <a href="/" className="text-xl font-bold text-gray-900">
              📖 小说智能工作台
            </a>
            <nav className="flex items-center gap-4 text-sm">
              <a href="/" className="text-gray-500 hover:text-blue-600">首页</a>
              <span className="text-gray-300">|</span>
              <a href="/adaptation" className="text-gray-500 hover:text-blue-600">📚 改编</a>
              <span className="text-gray-300">|</span>
              <a href="/write" className="text-gray-500 hover:text-blue-600">✍️ 创作</a>
              <span className="text-gray-300">|</span>
              <a href="/settings" className="text-gray-500 hover:text-blue-600">⚙ 设置</a>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
