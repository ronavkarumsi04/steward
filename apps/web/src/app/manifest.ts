import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Steward",
    short_name: "Steward",
    description: "Self-hosted autonomous company operating system.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f4f4f6",
    theme_color: "#1d1d1f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
