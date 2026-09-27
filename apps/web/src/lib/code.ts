/**
 * The pieces of the code IDE that are arithmetic rather than markup.
 *
 * Everything here is pure and takes the shapes the API sends, so the parts that are easy to get quietly wrong —
 * the line numbers either side of a hunk, which layer of a path a reader is looking for, whether an edit is
 * actually an edit — are decided once, in one place, and asserted in `code.test.ts`.
 */

import type { CodeChangeKind, CodeSessionState, FileDiff, CodeTreeEntry } from "./types";

export interface DiffRow {
  /** `hunk` is the `@@` header; `keep` is context. */
  kind: "hunk" | "add" | "remove" | "keep";
  /** The line without its terminator. */
  text: string;
  /** 1-based line number in the original file, or null where the line does not exist there. */
  before: number | null;
  /** 1-based line number in the proposed file, or null where the line does not exist there. */
  after: number | null;
  /** True when the line had no trailing newline — the one case a diff has to say out loud. */
  noFinalNewline: boolean;
}

/** A line with its own terminator removed, so CRLF files render as lines rather than as blank-looking rows. */
export function stripEol(line: string): string {
  return line.endsWith("\r\n") ? line.slice(0, -2) : line.endsWith("\n") ? line.slice(0, -1) : line;
}

/**
 * Turns a `FileDiff` into rows a person reads, numbering both sides as it goes.
 *
 * The numbering is the whole point: a removed line has an original number and no proposed one, an added line the
 * reverse, and context has both. That is what makes a diff checkable against the real file, and an off-by-one in
 * it is the kind of bug that makes a founder distrust the whole surface — so it is computed here and tested.
 */
export function diffRows(diff: FileDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of diff.hunks) {
    rows.push({
      kind: "hunk",
      text: `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`,
      before: null,
      after: null,
      noFinalNewline: false,
    });
    let before = hunk.beforeStart;
    let after = hunk.afterStart;
    for (const line of hunk.lines) {
      const marker = line[0] ?? " ";
      const text = stripEol(line.slice(1));
      const noFinalNewline = !line.endsWith("\n");
      if (marker === "+") {
        rows.push({ kind: "add", text, before: null, after, noFinalNewline });
        after += 1;
      } else if (marker === "-") {
        rows.push({ kind: "remove", text, before, after: null, noFinalNewline });
        before += 1;
      } else {
        rows.push({ kind: "keep", text, before, after, noFinalNewline });
        before += 1;
        after += 1;
      }
    }
  }
  return rows;
}

/** `M src/lib/api.ts` — the one line a reader scans a change list for. */
export const changeGlyph = (kind: CodeChangeKind): string => (kind === "added" ? "A" : kind === "deleted" ? "D" : "M");

/**
 * Whether an edit is worth staging. Staging the bytes a file already holds is not an error, but it is noise: it
 * would put a file in the patch that says nothing, so the surface says "no change" and leaves the patch clean.
 */
export const isNoChange = (original: string | null, contents: string | null): boolean =>
  contents !== null && original !== null && contents === original;

/**
 * Whether a line count is what a file currently has. Used to label a rename — a file whose path is unchanged but
 * whose bytes end identically is a no-op the API would refuse.
 */
export const lines = (text: string): number => stripEol(text).split(/\r\n|\n/).length;

/**
 * The files a founder means, filtered by what they typed.
 *
 * Every term has to match, and a term matches two ways: as a substring of the path (so `routes` finds
 * `apps/api/src/routes/code.ts`) or as a *subsequence of the file name* — the behaviour of every editor's fuzzy
 * finder, so `tst` finds `api.test.ts` and `ws` finds `code-workspace.tsx`. Substring matches rank above fuzzy
 * ones, and a path whose file name starts with a term ranks above the rest, because typing a name is the common
 * case and it should be at the top. Within a rank the repository's own order (sorted by path) is kept.
 */
export function filterTree(entries: CodeTreeEntry[], query: string, limit = 200): CodeTreeEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries.slice(0, limit);

  const score = (path: string, term: string): number | null => {
    const lower = path.toLowerCase();
    const file = splitPath(lower).file;
    if (file.startsWith(term)) return 0;
    if (lower.includes(term)) return 1;
    // Fuzzy: the term's characters in order anywhere in the file name.
    let cursor = 0;
    for (const character of file) {
      if (character === term[cursor]) cursor += 1;
      if (cursor === term.length) return 2;
    }
    return null;
  };

  const ranked: Array<{ entry: CodeTreeEntry; rank: number }> = [];
  for (const entry of entries) {
    let worst = -1;
    for (const term of terms) {
      const found = score(entry.path, term);
      if (found === null) {
        worst = -1;
        break;
      }
      worst = Math.max(worst, found);
    }
    if (worst >= 0) ranked.push({ entry, rank: worst });
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0))
    .slice(0, limit)
    .map((row) => row.entry);
}

/** Splits a path into the directory a reader skims and the file they are looking for. */
export function splitPath(path: string): { dir: string; file: string } {
  const at = path.lastIndexOf("/");
  return at === -1 ? { dir: "", file: path } : { dir: path.slice(0, at + 1), file: path.slice(at + 1) };
}

/** `12.4 kB` — sizes are shown rounded to three digits, which is all a founder needs to judge a file. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 100_000 ? 1 : 0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The name a patch downloads as, derived from the session so two sessions cannot collide on disk. */
export function patchFileName(session: { title: string; id: string }): string {
  const slug =
    session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "session";
  return `steward-${slug}-${session.id.slice(0, 8)}.patch`;
}

/** A one-line honest description of where a session is, for a pill and for a screen reader. */
export function sessionStateLabel(state: CodeSessionState): string {
  return {
    draft: "Draft",
    running: "Applying",
    applied: "Applied",
    failed: "Failed",
    discarded: "Discarded",
  }[state];
}

/** The tone a session's state is shown in. Matches the `Pill` tones the rest of the app uses. */
export function sessionStateTone(state: CodeSessionState): "neutral" | "accent" | "ok" | "warn" | "danger" {
  const tones = { draft: "neutral", running: "accent", applied: "ok", failed: "danger", discarded: "neutral" } as const;
  return tones[state];
}
