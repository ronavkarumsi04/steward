import type { Block } from "@steward/legal";

/** Renders one block of a legal document. Kept presentation-only so documents stay data. */
export function LegalBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p className="mt-3 text-[15px] leading-relaxed text-fg-2">{block.text}</p>;
    case "list":
      return block.ordered ? (
        <ol className="mt-3 list-decimal space-y-2 pl-6 text-[15px] leading-relaxed text-fg-2">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="mt-3 list-disc space-y-2 pl-6 text-[15px] leading-relaxed text-fg-2">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th key={h} scope="col" className="border-2 border-line bg-panel-2 px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-2 border-line px-3 py-2 align-top text-fg-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <aside className={`nb-panel-flat mt-4 px-4 py-3 ${block.tone === "warn" ? "nb-left-red" : "nb-left-purple"}`}>
          <p className="text-sm font-semibold">{block.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-2">{block.text}</p>
        </aside>
      );
    case "defs":
      return (
        <dl className="mt-3 space-y-3">
          {block.items.map((item) => (
            <div key={item.term}>
              <dt className="text-sm font-semibold">{item.term}</dt>
              <dd className="text-[15px] leading-relaxed text-fg-2">{item.text}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

/** Shared table shell for the generated tables (retention, subprocessors). */
export function LegalTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return <LegalBlock block={{ kind: "table", head, rows }} />;
}
