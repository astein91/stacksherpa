import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "stacksherpa - API provider directory",
  description: "Find the right API for your project. Pricing, compliance, benchmarks, known issues.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <div className="container">
            <h1>
              <a href="/">stacksherpa</a>
            </h1>
            <span className="tagline">API provider directory</span>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer>
          <div className="container">
            data updated every 12 hours &middot; powered by turso
          </div>
        </footer>
      </body>
    </html>
  );
}
