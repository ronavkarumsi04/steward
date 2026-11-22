"use client";

/** Preserve the API's line-based format without echoing credential values in the UI. */
export function SecretLines({ value, onChange, name }: { value: string; onChange: (value: string) => void; name: string }) {
  const rows = value.split("\n");
  return <div className="space-y-2">
    {rows.map((line, index) => <input key={index} type="password" autoComplete="off" spellCheck={false} className="input mono" aria-label={`${name}, line ${index + 1}`} value={line} onChange={event => onChange(rows.map((row, i) => i === index ? event.target.value : row).join("\n"))} onPaste={event => {
      const pasted = event.clipboardData.getData("text").replace(/\r\n?/g, "\n");
      if (!pasted.includes("\n")) return;
      event.preventDefault();
      const start = event.currentTarget.selectionStart ?? line.length;
      const end = event.currentTarget.selectionEnd ?? start;
      onChange(rows.map((row, i) => i === index ? `${line.slice(0, start)}${pasted}${line.slice(end)}` : row).join("\n"));
    }} />)}
    <button type="button" className="btn" onClick={() => onChange(`${value}\n`)}>Add line</button>
  </div>;
}
