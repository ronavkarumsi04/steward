import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/inbox",
    name: "Steward",
    short_name: "Steward",
    description: "An AI-native operating system for building and operating your company.",
    // The phone's job is the inbox: decide what the agents are waiting on, from wherever you are.
    start_url: "/app/inbox",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ebe7da",
    theme_color: "#17181c",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icon1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Inbox", short_name: "Inbox", description: "Approvals waiting on you", url: "/app/inbox" },
      { name: "Companies", short_name: "Companies", description: "Your workspaces", url: "/app" },
    ],
  };
}
