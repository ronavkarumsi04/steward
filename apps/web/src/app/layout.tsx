import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const DESCRIPTION = "Self-hosted, open-source autonomous company operating system. Persistent AI agents plan and execute your business work behind approval gates, budgets, and a durable audit trail.";

function siteUrl(): URL {
  const raw = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return new URL(raw);
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "Steward", template: "%s · Steward" },
  description: DESCRIPTION,
  applicationName: "Steward",
  openGraph: { type: "website", siteName: "Steward", title: "Steward", description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: "Steward", description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0e12" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
