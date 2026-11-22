import { CanvasTexture, SRGBColorSpace } from "three";

export type PaperKind = "work" | "approval" | "record";
const INK = "#202d79";
const STOCK = { work: "#fbfaf5", approval: "#f3e48f", record: "#f2c4cc" };

/** Owned, local artwork. No images, remote fonts, exports or model-service calls. */
export function paperTexture(kind: PaperKind, fonts: { editorial: string; mono: string }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1440;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Paper texture requires a 2D canvas");
  c.fillStyle = STOCK[kind];
  c.fillRect(0, 0, 1024, 1440);

  // Deterministic stock flecks: the paper never flickers on resize or reverse scroll.
  let seed = 27;
  c.fillStyle = "rgba(43, 57, 144, .045)";
  for (let i = 0; i < 4200; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = seed % 1024;
    seed = (seed * 16807) % 2147483647;
    c.fillRect(x, seed % 1440, 1, 2);
  }
  const text = (value: string, x: number, y: number, size: number, family = fonts.mono) => {
    c.fillStyle = INK;
    c.font = `500 ${size}px ${family}`;
    c.fillText(value, x, y);
  };
  const rule = (y: number, dashed = false) => {
    c.beginPath();
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.setLineDash(dashed ? [7, 8] : []);
    c.moveTo(66, y);
    c.lineTo(958, y);
    c.stroke();
    c.setLineDash([]);
  };

  text("STEWARD", 68, 162, 35);
  text(kind === "work" ? "01 / WORK ORDER" : kind === "approval" ? "02 / APPROVAL COPY" : "03 / RECORD COPY", 68, 241, 28);
  rule(275);
  text(kind === "work" ? "THE INSTRUCTION" : kind === "approval" ? "THE AUTHORITY" : "THE EVIDENCE", 68, 360, 24);

  const lines = kind === "work" ? ["A job.", "A budget.", "A boundary."]
    : kind === "approval" ? ["Your call.", "Before", "it ships."] : ["The work", "moves on.", "The record stays."];
  lines.forEach((line, index) => text(line, 60, 485 + index * 118, kind === "record" ? 83 : 106, fonts.editorial));

  if (kind === "work") {
    rule(890);
    text("PLAN", 70, 948, 29);
    text("ACT", 430, 948, 29);
    text("VERIFY", 780, 948, 29);
    text("Outcome defined", 70, 1080, 27);
    text("Limits set before action", 70, 1130, 27);
    text("Every step inspectable", 70, 1180, 27);
  } else {
    const rows = kind === "approval"
      ? [["AUTHORITY", "Yours to set"], ["CONSEQUENTIAL ACTION", "Waits for approval"], ["THE DECISION", "Yours to make"]]
      : [["PLAN + TOOL CALLS", "Inspectable"], ["COST + APPROVALS", "Traceable"], ["CANCEL A RUN", "Stop side effects"]];
    rows.forEach(([label, value], index) => {
      const y = 865 + index * 115;
      rule(y);
      text(label!, 68, y + 36, 21);
      text(value!, 68, y + 80, 37, fonts.editorial);
    });
  }
  rule(1260, true);
  text(kind === "work" ? "ACCOUNTABLE AUTONOMY" : kind === "approval" ? "THE AGENT CANNOT SIGN FOR YOU" : "ILLUSTRATED WORKFLOW · NOT A LIVE RUN", 68, 1325, 23);
  text("ONE INSTRUCTION. THREE COPIES.", 68, 1380, 20);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
