import { expect, it, vi } from "vitest";
import { SecretLines } from "./secret-lines";
import { parseEnv, parseHeaders } from "@/lib/mcp";

it("keeps multiple pasted credentials separate, including replacement and CRLF", () => {
  const onChange = vi.fn();
  const input = SecretLines({ value: "OLD=value\nKEEP=unchanged", onChange, name: "Environment" }).props.children[0][0];
  const preventDefault = vi.fn();
  input.props.onPaste({ clipboardData: { getData: () => "A=first\r\nB=second" }, preventDefault, currentTarget: { selectionStart: 0, selectionEnd: 9 } });
  expect(preventDefault).toHaveBeenCalled();
  expect(parseEnv(onChange.mock.calls[0]![0])).toEqual({ A: "first", B: "second", KEEP: "unchanged" });
});

it("inserts pasted headers at the selection without merging credentials", () => {
  const onChange = vi.fn();
  const input = SecretLines({ value: "X-One: stale", onChange, name: "Headers" }).props.children[0][0];
  input.props.onPaste({ clipboardData: { getData: () => "first\nX-Two: second" }, preventDefault: vi.fn(), currentTarget: { selectionStart: 7, selectionEnd: 12 } });
  expect(parseHeaders(onChange.mock.calls[0]![0])).toEqual({ "X-One": "first", "X-Two": "second" });
});
