import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { CodeBranchesRead, CodeTreeRead, CodeWorkspaceRead } from "@/lib/types";
import { CodeWorkspace } from "@/components/code-workspace";

export const metadata: Metadata = { title: "Code" };

/**
 * The code IDE route.
 *
 * The server render does the reading, so the page opens on the company's own repository rather than on a spinner:
 * the workspace (connection, sessions, agents), then — for the repository being read — its branches and its file
 * list at the chosen ref. The branch list has to come before the tree because a tree is read *at* a ref, and
 * guessing `main` would be a guess about someone else's repository.
 *
 * `?repo=` and `?ref=` are what make the page honest about *which* repository it is showing: a founder who picks
 * one by hand gets that choice written into the URL, so a reload, a bookmark or a pasted link reopens on the same
 * bytes instead of quietly falling back to a project's default. Both are validated before they are used — a
 * repository has to look like `owner/name`, and a ref that the repository does not have falls back to its default
 * branch rather than erroring — and neither is trusted for anything else: the API re-checks every path it is asked
 * for. Each read may fail on its own, because a stack with no GitHub connection still has a page to render, and
 * that page is where it explains what to connect.
 */
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export default async function CodePage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ repo?: string; ref?: string }>;
}) {
  const { companyId } = await params;
  const { repo: repoParam, ref: refParam } = await searchParams;
  const api = await serverApi();

  const workspace = await tryApi(() => api.get<CodeWorkspaceRead>(`/companies/${companyId}/code`));
  if (!workspace) notFound();

  const repo = repoParam && REPO_PATTERN.test(repoParam) ? repoParam : workspace.defaultRepo;
  const branches = repo ? await tryApi(() => api.get<CodeBranchesRead>(`/companies/${companyId}/code/branches?repo=${encodeURIComponent(repo)}`)) : null;
  const wanted = refParam && refParam.length <= 200 && branches?.branches.some((branch) => branch.name === refParam) ? refParam : null;
  const ref = wanted ?? branches?.defaultBranch ?? null;
  const tree = repo && ref ? await tryApi(() => api.get<CodeTreeRead>(`/companies/${companyId}/code/tree?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}`)) : null;

  return <CodeWorkspace companyId={companyId} initial={workspace} initialRepo={repo} initialRef={ref} initialTree={tree} initialBranches={branches} />;
}
