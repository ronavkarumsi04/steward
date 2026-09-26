import type { NextConfig } from "next";

const apiUrl = (process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
/**
 * Hosted deployments ship one Next app that also serves the API in-process (see
 * `src/app/embedded-api`). Local development keeps proxying to the standalone API on :4000 so its
 * watcher and the worker stay hot.
 */
const embeddedApi = process.env.EMBEDDED_API === "true";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is for the Docker image; Vercel builds its own serverless bundle.
  output: process.env.VERCEL ? undefined : "standalone",
  transpilePackages: ["@steward/legal", "@steward/schema"],
  /**
   * `pg` and `pino` (and Temporal, when configured) resolve native-ish runtime files that must stay
   * outside the server bundle; the API runtime imports them lazily on first request.
   */
  serverExternalPackages: ["pg", "pino", "@temporalio/client", "@temporalio/common", "@temporalio/worker"],
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
    const destination = embeddedApi ? "/embedded-api/v1/:path*" : `${apiUrl}/v1/:path*`;
    const routes = [{ source: "/api/v1/:path*", destination }];
    // `/health` lives at the API root rather than under /v1: expose it on the hosted origin so an
    // uptime monitor has something to poll, and only when this deployment serves the API itself.
    if (embeddedApi) routes.push({ source: "/health", destination: "/embedded-api/health" });
    return routes;
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
