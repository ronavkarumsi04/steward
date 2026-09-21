import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1d1d1f", borderRadius: 40 }}>
        <svg width="132" height="132" viewBox="0 0 24 24">
          <path d="M8 15.5c1 1 2.4 1.5 4 1.5 2.3 0 3.8-1.1 3.8-2.7 0-1.7-1.5-2.3-3.7-2.8-1.9-.4-3.1-.8-3.1-2 0-1.1 1.1-1.9 2.9-1.9 1.3 0 2.5.4 3.4 1.2" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
