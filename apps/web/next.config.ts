import type { NextConfig } from "next";

const apiUrl = (process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is for the Docker image; Vercel builds its own serverless bundle.
  output: process.env.VERCEL ? undefined : "standalone",
  transpilePackages: ["@steward/schema"],
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
