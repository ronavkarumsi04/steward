import { describe, expect, it } from "vitest";
import { changeGlyph, diffRows, filterTree, formatBytes, isNoChange, patchFileName, sessionStateLabel, sessionStateTone, splitPath, stripEol } from "./code";
import type { FileDiff } from "./types";

const entries = [
  { path: "README.md", size: 100 },
  { path: "apps/api/src/api.test.ts", size: 200 },
  { path: "apps/api/src/routes/code.ts", size: 300 },
  { path: "apps/web/src/lib/code.ts", size: 400 },
];

describe("diff rows", () => {
  it("numbers both sides of a hunk, and only where a line exists", () => {
    // `b` becomes `x` in a five-line file: one removal, one addition, context either side.
    const diff: FileDiff = {
      path: "a.txt",
      added: 1,
      removed: 1,
      hunks: [
        {
          beforeStart: 1,
          beforeCount: 1,
          afterStart: 1,
          afterCount: 1,
          lines: ["-b\n", "+x\n"],
        },
      ],
    };
    const rows = diffRows(diff);
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "remove", "add"]);
    expect(rows[1]).toMatchObject({ text: "b", before: 1, after: null });
    expect(rows[2]).toMatchObject({ text: "x", before: null, after: 1 });
  });

  it("advances context on both sides and additions on one", () => {
    // Original:  a b c d   Proposed:  a NEW b c d  — one addition after one context line, with one more after.
    const diff: FileDiff = {
      path: "a.txt",
      added: 1,
      removed: 0,
      hunks: [
        {
          beforeStart: 1,
          beforeCount: 3,
          afterStart: 1,
          afterCount: 4,
          lines: [" a\n", "+NEW\n", " b\n", " c\n"],
        },
      ],
    };
    const rows = diffRows(diff).filter((row) => row.kind !== "hunk");
    expect(rows.map((row) => [row.text, row.before, row.after])).toEqual([
      ["a", 1, 1],
      ["NEW", null, 2],
      ["b", 2, 3],
      ["c", 3, 4],
    ]);
  });

  it("starts a real hunk where the header says, not at line one", () => {
    // A change at line 41 has context lines 38..40 before it; the header carries the real offsets and the rows
    // continue from there. A hardcoded 1 here is the classic off-by-one a reader cannot see.
    const diff: FileDiff = {
      path: "big.ts",
      added: 1,
      removed: 1,
      hunks: [
        {
          beforeStart: 38,
          beforeCount: 4,
          afterStart: 38,
          afterCount: 4,
          lines: [" ctx\n", "-old\n", "+new\n", " ctx2\n"],
        },
      ],
    };
    const rows = diffRows(diff).filter((row) => row.kind !== "hunk");
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [38, 38],
      [39, null],
      [null, 39],
      [40, 40],
    ]);
  });

  it("keeps CRLF out of the text and says when the last line has no newline", () => {
    const diff: FileDiff = {
      path: "a.txt",
      added: 1,
      removed: 0,
      hunks: [
        {
          beforeStart: 1,
          beforeCount: 1,
          afterStart: 1,
          afterCount: 2,
          lines: [" keep\r\n", "+added without newline"],
        },
      ],
    };
    const rows = diffRows(diff).filter((row) => row.kind !== "hunk");
    expect(rows[0]).toMatchObject({ text: "keep", noFinalNewline: false });
    expect(rows[1]).toMatchObject({ text: "added without newline", noFinalNewline: true });
  });

  it("has nothing to show for a diff with no hunks", () => {
    expect(diffRows({ path: "a.txt", added: 0, removed: 0, hunks: [] })).toEqual([]);
  });
});

describe("tree filtering", () => {
  it("returns everything, capped, when nothing is typed", () => {
    expect(filterTree(entries, "  ").map((e) => e.path)).toEqual(entries.map((e) => e.path));
    expect(filterTree(entries, "", 2)).toHaveLength(2);
  });

  it("matches every term, anywhere in the path", () => {
    expect(filterTree(entries, "api").map((e) => e.path)).toEqual(["apps/api/src/api.test.ts", "apps/api/src/routes/code.ts"]);
    expect(filterTree(entries, "api tst").map((e) => e.path)).toEqual(["apps/api/src/api.test.ts"]);
    expect(filterTree(entries, "nope")).toEqual([]);
  });

  it("puts a path that ends with what was typed first", () => {
    const found = filterTree(entries, "code.ts");
    expect(found[0]!.path).toBe("apps/api/src/routes/code.ts");
    expect(found.map((e) => e.path)).toContain("apps/web/src/lib/code.ts");
  });
});

describe("paths and naming", () => {
  it("splits a path into the part to skim and the part to read", () => {
    expect(splitPath("apps/web/src/lib/code.ts")).toEqual({ dir: "apps/web/src/lib/", file: "code.ts" });
    expect(splitPath("README.md")).toEqual({ dir: "", file: "README.md" });
  });

  it("names a patch so two sessions cannot collide", () => {
    const name = patchFileName({ title: "Fix the login redirect!", id: "6f1c2a90-1111-2222-3333-444444444444" });
    expect(name).toBe("steward-fix-the-login-redirect-6f1c2a90.patch");
    expect(patchFileName({ title: "!!!", id: "abcdef0123456789" })).toBe("steward-session-abcdef01.patch");
  });

  it("formats bytes at a size a person reads", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(12_400)).toBe("12.4 kB");
    expect(formatBytes(240_000)).toBe("240 kB");
    expect(formatBytes(2_400_000)).toBe("2.4 MB");
  });
});

describe("change labels", () => {
  it("glyphs a change the way a patch does", () => {
    expect(changeGlyph("added")).toBe("A");
    expect(changeGlyph("deleted")).toBe("D");
    expect(changeGlyph("modified")).toBe("M");
  });

  it("knows when staging would propose nothing", () => {
    expect(isNoChange("x", "x")).toBe(true);
    expect(isNoChange("x", "y")).toBe(false);
    expect(isNoChange(null, "y")).toBe(false); // A new file is a change.
    expect(isNoChange("x", null)).toBe(false); // So is a deletion.
  });

  it("labels every session state, and none of them as success by accident", () => {
    const states = ["draft", "running", "applied", "failed", "discarded"] as const;
    expect(states.map(sessionStateLabel)).toEqual(["Draft", "Applying", "Applied", "Failed", "Discarded"]);
    expect(sessionStateTone("failed")).toBe("danger");
    expect(sessionStateTone("applied")).toBe("ok");
    expect(stripEol("a\r\n")).toBe("a");
    expect(stripEol("a\n")).toBe("a");
    expect(stripEol("a")).toBe("a");
  });
});
