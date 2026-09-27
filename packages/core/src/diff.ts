/**
 * Line diffs, computed here rather than asked of a provider.
 *
 * A code IDE has to show a founder what they are about to change, and the honest form of that is a real diff
 * against the bytes that are actually in the repository — not a summary, and not GitHub's diff of a branch that
 * does not exist yet. So the diff is ours: `diffLines` is Myers' algorithm (the standard O(ND) greedy line
 * diff), `unifiedDiff` is the part of the format a person reads, and both are pure so a test can round-trip them
 * (apply the diff to the original and get the changed text back, exactly).
 *
 * Two details are deliberate. Lines keep their own terminators, so a file with CRLF endings diffs as CRLF and a
 * file whose last line has no newline says so instead of silently gaining one — both are things a real commit
 * would otherwise change behind the author's back. And a hunk is emitted with context lines only where the change
 * is, so a one-character edit to a large file is not a diff of the whole file.
 */

export type DiffOp = "keep" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  line: string;
}

export interface DiffHunk {
  /** 1-based line number in the original, and how many original lines the hunk covers. */
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
  /** The hunk's lines: ` ` unchanged, `-` removed, `+` added. Each carries its own terminator. */
  lines: string[];
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

/**
 * Splits text into lines that keep their terminators. A trailing empty string (the usual artifact of a file that
 * ends with a newline) is dropped so that "three lines" means three lines, and the absence of a final newline
 * survives into the diff because the last line simply has no terminator.
 */
export function linesOf(text: string): string[] {
  if (text === "") return [];
  const parts = text.match(/[^\n]*\n|[^\n]+/g) ?? [];
  return parts;
}

const join = (lines: string[]): string => lines.join("");

/** Myers' greedy algorithm over two arrays, returning the edit script in order. */
function editScript(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  // `v[k]` is the furthest x reached on diagonal k, and each step's map is kept so the path can be walked back.
  const trace: Array<Map<number, number>> = [];
  let v = new Map<number, number>([[1, 0]]);
  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -Infinity) < (v.get(k + 1) ?? -Infinity));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
    // A fresh map per step, so a later step cannot see an earlier diagonal it did not reach.
    v = new Map(v);
  }
  if (found < 0) return [...before.map((line) => ({ op: "remove" as const, line })), ...after.map((line) => ({ op: "add" as const, line }))];

  const script: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const step = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && (step.get(k - 1) ?? -Infinity) < (step.get(k + 1) ?? -Infinity));
    const prevK = down ? k + 1 : k - 1;
    const prevX = step.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      script.push({ op: "keep", line: before[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (down) {
      script.push({ op: "add", line: after[prevY]! });
      y = prevY;
    } else {
      script.push({ op: "remove", line: before[prevX]! });
      x = prevX;
    }
  }
  while (x > 0 && y > 0) {
    script.push({ op: "keep", line: before[x - 1]! });
    x -= 1;
    y -= 1;
  }
  return script.reverse();
}

export function diffLines(before: string, after: string): DiffLine[] {
  return editScript(linesOf(before), linesOf(after));
}

/**
 * A unified diff with `context` lines around each change, in the shape `git diff` prints — so it can be pasted
 * into a terminal, a review, or a patch file without translation.
 */
export function unifiedDiff(before: string, after: string, path: string, context = 3): FileDiff {
  const script = diffLines(before, after);
  const hunks: DiffHunk[] = [];
  const isChange = (line: DiffLine | undefined) => line !== undefined && line.op !== "keep";

  let index = 0;
  while (index < script.length) {
    if (!isChange(script[index])) {
      index += 1;
      continue;
    }
    // Walk back for context, then forward to the end of this change (merging changes closer than 2×context).
    let start = index;
    let lead = 0;
    while (start > 0 && script[start - 1]!.op === "keep" && lead < context) {
      start -= 1;
      lead += 1;
    }
    let end = index;
    let tail = 0;
    let cursor = index;
    while (cursor < script.length) {
      if (isChange(script[cursor])) {
        end = cursor;
        tail = 0;
      } else if (tail < context * 2) {
        tail += 1;
      } else {
        break;
      }
      cursor += 1;
    }
    const slice = script.slice(start, Math.min(end + 1 + context, script.length));
    let beforeStart = 1;
    let afterStart = 1;
    for (const line of script.slice(0, start)) {
      if (line.op !== "add") beforeStart += 1;
      if (line.op !== "remove") afterStart += 1;
    }
    hunks.push({
      beforeStart,
      beforeCount: slice.filter((line) => line.op !== "add").length,
      afterStart,
      afterCount: slice.filter((line) => line.op !== "remove").length,
      lines: slice.map((line) => `${line.op === "keep" ? " " : line.op === "add" ? "+" : "-"}${line.line}`),
    });
    index = end + 1;
  }

  return {
    path,
    added: script.filter((line) => line.op === "add").length,
    removed: script.filter((line) => line.op === "remove").length,
    hunks,
  };
}

/**
 * The diff as text: what a person reads and what a patch file expects, including the `\ No newline at end of
 * file` marker — without it, a patch that changes the last line of a file would silently add a newline when it
 * is applied, which is a change nobody asked for.
 */
export function formatDiff(diff: FileDiff): string {
  if (diff.hunks.length === 0) return "";
  const lines = [`--- a/${diff.path}\n`, `+++ b/${diff.path}\n`];
  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@\n`);
    for (const line of hunk.lines) lines.push(line.endsWith("\n") ? line : `${line}\n\\ No newline at end of file\n`);
  }
  return lines.join("");
}

/**
 * Applies a diff to the original text. This is not how a change is committed — a commit writes whole files — but
 * it is how the diff is *proved*: a test reconstructs the new text from the old text and the hunks it produced,
 * which is the only way to know the diff is not a plausible-looking summary.
 */
export function applyDiff(before: string, diff: Pick<FileDiff, "hunks">): string {
  const original = linesOf(before);
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of diff.hunks) {
    const start = hunk.beforeStart - 1;
    if (start < cursor) throw new Error("diff hunks overlap");
    out.push(...original.slice(cursor, start));
    let consumed = 0;
    for (const line of hunk.lines) {
      const marker = line.slice(0, 1);
      const text = line.slice(1);
      if (marker === " ") {
        if (original[start + consumed] !== text) throw new Error(`context mismatch at line ${start + consumed + 1}`);
        out.push(text);
        consumed += 1;
      } else if (marker === "-") {
        if (original[start + consumed] !== text) throw new Error(`removal mismatch at line ${start + consumed + 1}`);
        consumed += 1;
      } else if (marker === "+") {
        out.push(text);
      } else {
        throw new Error(`unknown diff marker ${JSON.stringify(marker)}`);
      }
    }
    cursor = start + consumed;
  }
  out.push(...original.slice(cursor));
  return join(out);
}

/** How big a change is, in the words a founder reads: "3 lines added, 1 removed". */
export function diffSummary(diff: FileDiff): string {
  if (diff.hunks.length === 0) return "no change";
  const parts = [];
  if (diff.added) parts.push(`${diff.added} line${diff.added === 1 ? "" : "s"} added`);
  if (diff.removed) parts.push(`${diff.removed} line${diff.removed === 1 ? "" : "s"} removed`);
  return parts.join(", ");
}
