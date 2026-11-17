import { Fragment, type ReactNode } from "react";

export function runOutput(result: Record<string, unknown> | null): unknown {
  if (!result) return null;
  const { summary: _summary, verification: _verification, finalText, ...fields } = result;
  if (finalText != null && finalText !== "") return finalText;
  return Object.keys(fields).length ? fields : null;
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> :
      /^`[^`]+`$/.test(part) ? <code key={i} className="mono text-xs">{part.slice(1, -1)}</code> : part,
  );
}

function TextOutput({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={blocks.length} className="overflow-x-auto whitespace-pre-wrap rounded border border-line p-3 text-xs"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h3 key={blocks.length} className="text-base font-semibold">{inline(heading[1]!)}</h3>);
      i++;
      continue;
    }
    const list = /^\s*(?:[-*+] |\d+[.)] )\s*\S/.exec(line);
    if (list) {
      const ordered = /^\s*\d/.test(line);
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      const items: ReactNode[] = [];
      let match: RegExpExecArray | null;
      while (i < lines.length && (match = pattern.exec(lines[i]!))) {
        const task = /^\[([ xX])\]\s+(.*)$/.exec(match[1]!);
        items.push(<li key={i}>{task ? <><span aria-label={task[1]!.toLowerCase() === "x" ? "Completed" : "Not completed"}>{task[1]!.toLowerCase() === "x" ? "☑" : "☐"}</span> {inline(task[2]!)}</> : inline(match[1]!)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={blocks.length} start={Number(/^\s*(\d+)/.exec(line)?.[1] ?? 1)} className="list-decimal space-y-1 pl-6">{items}</ol> : <ul key={blocks.length} className="list-disc space-y-1 pl-6">{items}</ul>);
      continue;
    }
    blocks.push(<p key={blocks.length} className="whitespace-pre-wrap">{inline(line)}</p>);
    i++;
  }
  return <div className="space-y-3">{blocks}</div>;
}

export function RunOutput({ value }: { value: unknown }) {
  if (value == null || value === "") return <p className="text-sm text-muted">No output recorded.</p>;
  if (typeof value === "string") return <div className="break-words text-sm text-fg-2"><TextOutput text={value} /></div>;
  if (Array.isArray(value)) return value.length ? <ul className="list-disc space-y-2 pl-6">{value.map((item, i) => <li key={i}><RunOutput value={item} /></li>)}</ul> : <p className="text-sm text-muted">No items.</p>;
  if (typeof value === "object") {
    const fields = Object.entries(value);
    return fields.length ? <dl className="space-y-3">{fields.map(([key, field]) => <Fragment key={key}><dt className="text-sm font-semibold">{key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")}</dt><dd className="pl-3"><RunOutput value={field} /></dd></Fragment>)}</dl> : <p className="text-sm text-muted">No fields.</p>;
  }
  return <p className="text-sm text-fg-2">{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</p>;
}
