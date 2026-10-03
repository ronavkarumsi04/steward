import { ImageResponse } from "next/og";
import { StewardMark } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f4ec", color: "#182d28", borderRadius: 40 }}><StewardMark size={132} /></div>, size);
}
