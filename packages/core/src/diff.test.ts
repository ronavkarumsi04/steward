/**
 * The diff engine, tested as arithmetic rather than as output.
 *
 * Printing a diff that looks right is easy; the thing that matters is that the diff is *true* — so the central
 * test here applies the hunks back to the original text and requires the changed text to come out, character for
 * character, for hand-written cases and for a few hundred generated ones. Terminators are part of the data: a
 * CRLF file diffs as CRLF, and a file whose last line has no newline keeps it that way, because otherwise a
 * commit would quietly change bytes nobody asked about.
 */
import { describe, expect, it } from "vitest";
import { applyDiff, diffLines, diffSummary, formatDiff, linesOf, unifiedDiff } from "./diff.js";

const roundTrip = (before: string, after: string) => {
  const diff = unifiedDiff(before, after, "src/file.ts");
  expect(applyDiff(before, diff)).toBe(after);
  return diff;
};

describe("splitting text into lines", () => {
  it("keeps each line's own terminator, and the absence of one", () => {
    expect(linesOf("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(linesOf("a\nb")).toEqual(["a\n", "b"]);
    expect(linesOf("a\r\nb\r\n")).toEqual(["a\r\n", "b\r\n"]);
    expect(linesOf("")).toEqual([]);
    expect(linesOf("\n")).toEqual(["\n"]);
    expect(linesOf("a\n\nb")).toEqual(["a\n", "\n", "b"]);
  });
});

/** The script as the markers a unified diff would print: ` x`, `-x`, `+x`. */
const markers = (before: string, after: string) => diffLines(before, after).map((line) => `${line.op === "keep" ? " " : line.op === "add" ? "+" : "-"}${line.line.replace(/\r?\n$/, "")}`);

describe("the edit script", () => {
  it("says what changed and what stayed, in order", () => {
    expect(diffLines("a\nb\nc\n", "a\nb\nc\n").map((line) => line.op)).toEqual(["keep", "keep", "keep"]);
    // A one-line edit is a removal and an addition, not a rewrite of the file.
    expect(markers("a\nb\nc\n", "a\nX\nc\n")).toEqual([" a", "-b", "+X", " c"]);
    expect(markers("a\nc\n", "a\nb\nc\n")).toEqual([" a", "+b", " c"]);
    expect(markers("a\nb\nc\n", "a\nc\n")).toEqual([" a", "-b", " c"]);
  });

  it("handles the empty ends of a file", () => {
    expect(diffLines("", "one\ntwo\n").map((line) => line.op)).toEqual(["add", "add"]);
    expect(diffLines("one\ntwo\n", "").map((line) => line.op)).toEqual(["remove", "remove"]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("finds the shared lines in text that moved, rather than calling it all new", () => {
    const script = diffLines("a\nb\nc\nd\n", "b\nc\nd\ne\n");
    expect(script.filter((line) => line.op === "keep").map((line) => line.line)).toEqual(["b\n", "c\n", "d\n"]);
    expect(script.filter((line) => line.op === "remove").map((line) => line.line)).toEqual(["a\n"]);
    expect(script.filter((line) => line.op === "add").map((line) => line.line)).toEqual(["e\n"]);
  });
});

describe("unified hunks", () => {
  it("prints the format a person reads and a patch file expects", () => {
    const diff = unifiedDiff("a\nb\nc\n", "a\nX\nc\n", "src/file.ts", 1);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(formatDiff(diff)).toBe(["--- a/src/file.ts\n", "+++ b/src/file.ts\n", "@@ -1,3 +1,3 @@\n", " a\n", "-b\n", "+X\n", " c\n"].join(""));
    expect(diffSummary(diff)).toBe("1 line added, 1 line removed");
  });

  it("is empty when nothing changed, and says so", () => {
    const diff = unifiedDiff("same\n", "same\n", "a.ts");
    expect(diff.hunks).toEqual([]);
    expect(diffSummary(diff)).toBe("no change");
    expect(formatDiff(diff)).toBe("");
  });

  it("keeps a small change in a large file small", () => {
    const before = Array.from({ length: 500 }, (_, index) => `line ${index}\n`).join("");
    const after = before.replace("line 250\n", "line 250 changed\n");
    const diff = roundTrip(before, after);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    // Three lines of context on each side, plus the removal and the addition — and not the whole file.
    expect(diff.hunks[0]!.lines).toHaveLength(8);
    expect(diff.hunks[0]!.beforeStart).toBe(248);
    expect(diff.hunks[0]!.afterStart).toBe(248);
  });

  it("separates distant changes and merges neighbouring ones", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `${index}\n`);
    const changeAt = (indexes: number[]) => lines.map((line, index) => (indexes.includes(index) ? `changed ${index}\n` : line)).join("");
    // Changes six lines apart share their context, so one hunk is what a reader wants (and what git prints).
    expect(roundTrip(lines.join(""), changeAt([2, 8])).hunks).toHaveLength(1);
    // Farther apart, two hunks — and both are still local, with the untouched middle left out.
    const far = roundTrip(lines.join(""), changeAt([2, 15]));
    expect(far.hunks).toHaveLength(2);
    expect(far.hunks[0]!.lines.length + far.hunks[1]!.lines.length).toBeLessThan(lines.length);
  });

  it("states hunk line numbers that agree with the lines it lists", () => {
    const body = Array.from({ length: 24 }, (_, index) => `line ${index}\n`);
    const before = body.join("");
    const after = body.map((line, index) => (index === 2 ? "THREE\n" : index === 22 ? "TWENTY TWO\n" : line)).join("");
    const diff = roundTrip(before, after);
    expect(diff.hunks).toHaveLength(2);
    for (const hunk of diff.hunks) {
      expect(hunk.lines.filter((line) => !line.startsWith("+"))).toHaveLength(hunk.beforeCount);
      expect(hunk.lines.filter((line) => !line.startsWith("-"))).toHaveLength(hunk.afterCount);
    }
  });

  it("keeps terminators exactly, including a last line with none", () => {
    const crlf = roundTrip("a\r\nb\r\n", "a\r\nc\r\n");
    expect(crlf.hunks[0]!.lines).toContain("-b\r\n");
    expect(crlf.hunks[0]!.lines).toContain("+c\r\n");

    const noFinalNewline = roundTrip("a\nb", "a\nc");
    expect(noFinalNewline.hunks[0]!.lines).toContain("-b");
    expect(noFinalNewline.hunks[0]!.lines).toContain("+c");
    // The patch says so, rather than quietly adding the newline when it is applied.
    expect(formatDiff(noFinalNewline)).toContain("\\ No newline at end of file");
    // Adding the missing newline is a change of its own, not a silent side effect.
    const added = unifiedDiff("a\nb", "a\nb\n", "a.txt");
    expect(added.added).toBe(1);
    expect(added.removed).toBe(1);
  });

  it("refuses to apply hunks that do not describe the text it was given", () => {
    const diff = unifiedDiff("a\nb\n", "a\nc\n", "a.txt");
    expect(() => applyDiff("x\ny\n", diff)).toThrow(/mismatch/);
  });
});

describe("applying a diff to the original text", () => {
  it("reconstructs the changed text for generated pairs", () => {
    // A small deterministic generator: the property under test is the equality, not the randomness.
    let seed = 20_260_927;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };
    const alphabet = ["alpha\n", "beta\n", "gamma\n", "delta\n", "", "  indented\n"];
    for (let round = 0; round < 300; round += 1) {
      const before = Array.from({ length: next(14) }, () => alphabet[next(alphabet.length)]!).join("");
      const after = Array.from({ length: next(14) }, () => alphabet[next(alphabet.length)]!).join("");
      const diff = unifiedDiff(before, after, "generated.txt");
      expect(applyDiff(before, diff), `round ${round}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`).toBe(after);
    }
  }, 30_000);
});
