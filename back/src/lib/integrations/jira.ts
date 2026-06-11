function base(metadata: any) {
  const cloudId = metadata?.cloudId;
  if (!cloudId) throw new Error("Integración Jira sin cloudId — reconecta la integración");
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
}

async function jiraFetch(token: string, metadata: any, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${base(metadata)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
  return res.json();
}

const toADF = (text: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text: text || "—" }] }],
});

export async function createIssue(
  token: string,
  metadata: any,
  input: { projectKey: string; summary: string; description?: string; priority?: string }
) {
  const fields: any = {
    project: { key: input.projectKey },
    summary: input.summary,
    description: toADF(input.description ?? ""),
    issuetype: { name: "Task" },
  };
  if (input.priority) fields.priority = { name: input.priority };
  const res = await jiraFetch(token, metadata, "/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return { ok: true, key: res.key, url: `${metadata?.site}/browse/${res.key}` };
}

export async function searchIssues(token: string, metadata: any, jql: string) {
  const res = await jiraFetch(
    token,
    metadata,
    `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary,status,priority`
  );
  return (res.issues ?? []).map((i: any) => ({
    key: i.key,
    summary: i.fields?.summary,
    status: i.fields?.status?.name,
    priority: i.fields?.priority?.name,
  }));
}
