import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/feedback";
import { NavigationTransitions } from "@/components/navigation-transitions";
import "./globals.css";

/** Applies the persisted light/dark choice before first paint to avoid a flash of the wrong theme. */
const THEME_INIT = `(function(){try{var t=localStorage.getItem("steward-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}})();`;

const DESCRIPTION = "Steward is an AI-native company operating system. Connect your agents, tools and company context with approval gates, budgets and an inspectable record of the work.";

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
    { media: "(prefers-color-scheme: light)", color: "#f5f4ec" },
    { media: "(prefers-color-scheme: dark)", color: "#101e18" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen">
        <NavigationTransitions />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
