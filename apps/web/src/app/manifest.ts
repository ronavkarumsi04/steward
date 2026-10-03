import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Steward",
    short_name: "Steward",
    description: "An AI-native operating system for building and operating your company.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5f4ec",
    theme_color: "#182d28",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
