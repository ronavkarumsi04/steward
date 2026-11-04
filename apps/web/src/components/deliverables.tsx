import type { Document } from "@/lib/types";

/** Slides from a deck written by `document.deck`: `---` sections with a `## N. heading`, bullets and a quoted speaker note. */
export function parseDeck(markdown: string): Array<{ heading: string; bullets: string[]; note: string | null }> {
  return markdown
    .split(/\n---\n/)
    .slice(1)
    .map((section) => {
      const lines = section.split("\n").map((l) => l.trim());
      const heading = (lines.find((l) => l.startsWith("## ")) ?? "").replace(/^## (\d+\.\s*)?/, "");
      const bullets = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
      const note = lines.filter((l) => l.startsWith("> ")).map((l) => l.slice(2)).join(" ") || null;
      return { heading, bullets, note };
    })
    .filter((s) => s.heading);
}

/** Header, alignment and rows from the table written by `document.sheet`. */
export function parseSheet(markdown: string): { header: string[]; numeric: boolean[]; rows: string[][] } | null {
  const lines = markdown.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return null;
  const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const header = cells(lines[0]!);
  const numeric = cells(lines[1]!).map((c) => c.endsWith(":"));
  const rows = lines.slice(2).map(cells);
  return { header, numeric, rows };
}

const strip = (s: string) => s.replace(/^\*\*(.*)\*\*$/, "$1");

export function DeckView({ doc }: { doc: Document }) {
  const slides = parseDeck(doc.content ?? "");
  return (
    <div className="space-y-3" aria-label={`Deck: ${doc.title}`}>
      <p className="text-xs uppercase tracking-wide text-muted">{slides.length} slides · v{doc.version}</p>
      <ol className="grid gap-3 md:grid-cols-2">
        {slides.map((s, i) => (
          <li key={i} className="nb-panel-flat nb-left-blue flex min-h-40 flex-col p-4 print:break-inside-avoid">
            <span className="mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-1 text-base font-semibold">{s.heading}</h3>
            {s.bullets.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{s.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
            {s.note && <p className="mt-auto pt-3 text-xs italic text-muted">Note: {s.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SheetView({ doc }: { doc: Document }) {
  const sheet = parseSheet(doc.content ?? "");
  if (!sheet) return <p className="text-sm text-muted">This sheet has no table yet.</p>;
  const total = sheet.rows.at(-1)?.[0]?.startsWith("**") ? sheet.rows.at(-1)! : null;
  const body = total ? sheet.rows.slice(0, -1) : sheet.rows;
  return (
    <div className="overflow-x-auto" aria-label={`Sheet: ${doc.title}`}>
      <table className="w-full border-collapse text-sm">
        <thead><tr>{sheet.header.map((h, i) => <th key={i} scope="col" className={`border-b border-line px-2 py-1 text-xs uppercase tracking-wide text-muted ${sheet.numeric[i] ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody>{body.map((r, ri) => <tr key={ri} className="border-b border-line">{r.map((c, ci) => <td key={ci} className={`px-2 py-1 ${sheet.numeric[ci] ? "mono text-right" : ""}`}>{c}</td>)}</tr>)}</tbody>
        {total && <tfoot><tr>{total.map((c, ci) => <td key={ci} className={`px-2 py-1 font-semibold ${sheet.numeric[ci] ? "mono text-right" : ""}`}>{strip(c)}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}
