import { ImageResponse } from "next/og";
import { StewardMark } from "@/components/brand";

/** The maskable home-screen icon: the mark on the binding colour, with the safe-zone margin a round mask needs. */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function MaskableIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#17181c", color: "#f8f6ef" }}>
      <StewardMark size={300} />
    </div>,
    size,
  );
}
