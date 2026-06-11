const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailFetch(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function decodeBody(payload: any): string {
  if (payload?.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload?.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf8");
    }
  }
  for (const part of payload?.parts ?? []) {
    const nested = decodeBody(part);
    if (nested) return nested;
  }
  return "";
}

function header(payload: any, name: string) {
  return payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function listEmails(token: string, query = "is:unread", maxResults = 10) {
  const list = await gmailFetch(
    token,
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
  );
  const messages = [];
  for (const m of list.messages ?? []) {
    const full = await gmailFetch(token, `/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    messages.push({
      id: m.id,
      subject: header(full.payload, "Subject"),
      from: header(full.payload, "From"),
      date: header(full.payload, "Date"),
      snippet: full.snippet,
    });
  }
  return messages;
}

export async function readEmail(token: string, id: string) {
  const full = await gmailFetch(token, `/messages/${id}?format=full`);
  return {
    id,
    subject: header(full.payload, "Subject"),
    from: header(full.payload, "From"),
    date: header(full.payload, "Date"),
    body: decodeBody(full.payload).slice(0, 8000),
  };
}

export async function labelEmail(token: string, id: string, labelName: string) {
  const labels = await gmailFetch(token, "/labels");
  let label = labels.labels?.find(
    (l: any) => l.name.toLowerCase() === labelName.toLowerCase()
  );
  if (!label) {
    label = await gmailFetch(token, "/labels", {
      method: "POST",
      body: JSON.stringify({ name: labelName }),
    });
  }
  await gmailFetch(token, `/messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: [label.id] }),
  });
  return { ok: true, label: labelName };
}

export async function archiveEmail(token: string, id: string) {
  await gmailFetch(token, `/messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });
  return { ok: true };
}

export async function sendEmail(token: string, to: string, subject: string, body: string) {
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString("base64url");
  const res = await gmailFetch(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return { ok: true, id: res.id };
}
