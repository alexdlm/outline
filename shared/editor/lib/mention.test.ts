import { UnfurlResourceType, type UnfurlResponse } from "../../types";
import { toPersistedUnfurl } from "./mention";

const issue: UnfurlResponse[UnfurlResourceType.Issue] = {
  type: UnfurlResourceType.Issue,
  url: "https://github.com/acme/infra/issues/2",
  id: "#2",
  title: "Control plane Helm chart",
  description: "A long description that should not be stored.",
  author: { name: "octocat", avatarUrl: "https://example.com/avatar.png" },
  labels: [{ name: "bug", color: "#ff0000" }],
  state: { type: "started", name: "open", color: "#00ff00" },
  createdAt: "2024-01-01T00:00:00.000Z",
};

const pullRequest: UnfurlResponse[UnfurlResourceType.PR] = {
  type: UnfurlResourceType.PR,
  url: "https://github.com/acme/infra/pull/42",
  id: "#42",
  title: "Add Helm chart",
  description: "A long description that should not be stored.",
  author: { name: "octocat", avatarUrl: "https://example.com/avatar.png" },
  state: { name: "open", color: "#00ff00", draft: false },
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("toPersistedUnfurl", () => {
  it("keeps only the core fields of an issue and drops its description", () => {
    const withExtension = { ...issue, extension: { secret: "value" } };

    expect(toPersistedUnfurl(withExtension)).toEqual({
      type: UnfurlResourceType.Issue,
      url: issue.url,
      id: issue.id,
      title: issue.title,
      description: null,
      author: issue.author,
      labels: issue.labels,
      state: issue.state,
      createdAt: issue.createdAt,
    });
  });

  it("does not modify the unfurl it is given", () => {
    toPersistedUnfurl(issue);

    expect(issue.description).toEqual(
      "A long description that should not be stored."
    );
  });

  it("uses the renderer's reducer for issues when it has one", () => {
    const reduced = { ...issue, title: "Reduced", description: null };
    const persistedUnfurl = vi.fn(() => reduced);

    expect(toPersistedUnfurl(issue, { persistedUnfurl })).toBe(reduced);
    expect(persistedUnfurl).toHaveBeenCalledWith(issue);
  });

  it("falls back to the core fields when the renderer has no reducer", () => {
    expect(toPersistedUnfurl(issue, {})).toEqual({
      ...issue,
      description: null,
    });
  });

  it("drops the description of a pull request and keeps its other fields", () => {
    const persistedUnfurl = vi.fn();

    expect(toPersistedUnfurl(pullRequest, { persistedUnfurl })).toEqual({
      ...pullRequest,
      description: null,
    });
    expect(persistedUnfurl).not.toHaveBeenCalled();
  });

  it("passes other unfurls through unchanged", () => {
    const link: UnfurlResponse[UnfurlResourceType.URL] = {
      type: UnfurlResourceType.URL,
      url: "https://example.com/page",
      title: "Example",
      description: "An example page.",
      thumbnailUrl: "https://example.com/image.png",
      faviconUrl: "https://example.com/favicon.ico",
    };

    expect(toPersistedUnfurl(link)).toBe(link);
  });
});
