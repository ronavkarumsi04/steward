import { ImageResponse } from "next/og";

export const alt = "Steward — the self-hosted autonomous company operating system";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#ffd43b", color: "#111111", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 8, background: "#8b5cf6", border: "3px solid #111111", boxShadow: "6px 6px 0 #111111", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="52" height="52" viewBox="0 0 24 24">
              <path d="M8 15.5c1 1 2.4 1.5 4 1.5 2.3 0 3.8-1.1 3.8-2.7 0-1.7-1.5-2.3-3.7-2.8-1.9-.4-3.1-.8-3.1-2 0-1.1 1.1-1.9 2.9-1.9 1.3 0 2.5.4 3.4 1.2" fill="none" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>Steward</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02, maxWidth: 1000 }}>Agents that run your company. You keep the keys.</div>
          <div style={{ fontSize: 32, color: "#292820", maxWidth: 960 }}>Self-hosted, open-source autonomous company operating system with approval gates, budgets, and a durable audit trail.</div>
        </div>
      </div>
    ),
    size,
  );
}
