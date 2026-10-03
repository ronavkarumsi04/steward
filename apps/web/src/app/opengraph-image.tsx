import { StewardMark } from "@/components/brand";
import { ImageResponse } from "next/og";

export const alt =
  "Steward — Big ideas. Real momentum. An AI-native company operating system.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f5f4ec",
        color: "#182d28",
        padding: "52px 70px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #ced2c7",
          paddingBottom: 25,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 32, fontWeight: 700, letterSpacing: -1 }}><StewardMark size={36} />steward</span>
        <span style={{ fontSize: 13, letterSpacing: 2 }}>
          THE COMPANY OPERATING SYSTEM
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          paddingTop: 55,
          fontSize: 112,
          letterSpacing: -7,
          lineHeight: 1,
        }}
      >
        <span>Big ideas.</span>
        <span style={{ paddingLeft: 90, fontStyle: "italic", paddingTop: 12 }}>
          Real momentum.
        </span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid #ced2c7",
          paddingTop: 25,
        }}
      >
        <span style={{ fontSize: 19 }}>Build. Operate. Stay in control.</span>
        <span
          style={{
            fontSize: 14,
            background: "#d9edc8",
            padding: "12px 20px",
            borderRadius: 30,
          }}
        >
          Your company. Your control.
        </span>
      </div>
    </div>,
    size,
  );
}
