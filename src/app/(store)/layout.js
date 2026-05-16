import "@/app/globals.css";
import StoreNav from "./components/StoreNav";

export const metadata = {
  title: "9Router — Multi-provider LLM Gateway",
  description: "Gateway thông minh tới các nhà cung cấp LLM hàng đầu. Smart routing, fallback, quota cứng, billing minh bạch.",
};

export default function StoreLayout({ children }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-text-main antialiased">
        <StoreNav />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
        <footer className="mt-16 border-t border-border-subtle px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-text-muted sm:flex-row">
            <p>© {new Date().getFullYear()} 9Router. Multi-provider LLM gateway cho VN.</p>
            <div className="flex gap-4">
              <a href="/store/docs" className="hover:text-primary">API Docs</a>
              <a href="/store/pricing" className="hover:text-primary">Pricing</a>
              <a href="/store/models" className="hover:text-primary">Models</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
