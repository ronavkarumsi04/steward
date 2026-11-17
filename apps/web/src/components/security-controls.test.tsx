import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutEverywhere } from "./security-controls";

const mocks = vi.hoisted(() => ({ post: vi.fn(), replace: vi.fn(), refresh: vi.fn(), state: [] as unknown[], cursor: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("@/lib/api", () => ({ browserApi: { post: mocks.post } }));
vi.mock("./locale-provider", async () => {
  const { t } = await import("@/lib/i18n");
  return { useT: () => (key: Parameters<typeof t>[1]) => t("en", key) };
});
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.state)) mocks.state[index] = initial;
    return [mocks.state[index], (value: unknown) => { mocks.state[index] = value; }];
  },
}));

type Node = ReactElement<{ children?: Node | Node[]; onClick?: () => Promise<void> | void; disabled?: boolean }>;
function render() {
  mocks.cursor = 0;
  return SignOutEverywhere() as Node;
}
function buttons(node: Node): Node[] {
  if (!node || typeof node !== "object") return [];
  if (node.type === "button") return [node];
  return [node.props.children].flat().flatMap((child) => buttons(child as Node));
}

beforeEach(() => { vi.clearAllMocks(); mocks.state = []; mocks.cursor = 0; });

describe("SignOutEverywhere", () => {
  it("requires confirmation and cancel makes no request", () => {
    expect(renderToStaticMarkup(render())).not.toContain("All your sessions will end");
    buttons(render())[0]!.props.onClick!();
    expect(renderToStaticMarkup(render())).toContain("All your sessions will end");
    buttons(render())[1]!.props.onClick!();
    expect(buttons(render())).toHaveLength(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("posts only after confirmation, disables pending controls, and redirects on success", async () => {
    let resolve!: () => void;
    mocks.post.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    buttons(render())[0]!.props.onClick!();
    buttons(render())[0]!.props.onClick!();
    expect(mocks.post).toHaveBeenCalledWith("/auth/logout-all");
    expect(buttons(render()).every((button) => button.props.disabled)).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
    resolve();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("shows an error and enables retry without redirecting on failure", async () => {
    mocks.post.mockRejectedValueOnce(new Error("offline"));
    buttons(render())[0]!.props.onClick!();
    buttons(render())[0]!.props.onClick!();
    await vi.waitFor(() => expect(mocks.state[2]).toBe("Could not sign out everywhere. Please try again."));
    expect(renderToStaticMarkup(render())).toContain('role="alert"');
    expect(buttons(render()).every((button) => !button.props.disabled)).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
