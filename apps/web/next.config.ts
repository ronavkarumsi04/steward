import type { NextConfig } from "next";

const apiUrl = (process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is for the Docker image; Vercel builds its own serverless bundle.
  output: process.env.VERCEL ? undefined : "standalone",
  transpilePackages: ["@steward/legal", "@steward/schema"],
  /**
   * Root-level legal URLs. Reviewers, app-directory listings, and Google's OAuth verification all
   * look for /privacy and /terms at the root rather than under a subdirectory, and a broken link in
   * a consent screen is a common reason a verification gets bounced.
   */
  async redirects() {
    const aliases = ["terms", "privacy", "acceptable-use", "cookies", "subprocessors", "dpa", "retention", "security", "accessibility", "api-terms", "copyright", "third-party-notices", "support", "ai-terms", "integrations"];
    return [
      ...aliases.map((slug) => ({ source: `/${slug}`, destination: `/legal/${slug}`, permanent: false })),
      // Short forms people actually type or that policies commonly reference.
      { source: "/tos", destination: "/legal/terms", permanent: false },
      { source: "/aup", destination: "/legal/acceptable-use", permanent: false },
      { source: "/privacy-policy", destination: "/legal/privacy", permanent: false },
      { source: "/legal/terms-of-service", destination: "/legal/terms", permanent: false },
    ];
  },
  async rewrites() {
    // Same-origin proxy to the API so cookies are first-party and CSRF Origin checks hold.
    return [{ source: "/api/v1/:path*", destination: `${apiUrl}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
