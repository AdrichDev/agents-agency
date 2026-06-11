async function slackFetch(token: string, method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(`Slack API ${method}: ${data.error}`);
  return data;
}

async function resolveChannel(token: string, channel: string): Promise<string> {
  if (!channel.startsWith("#")) return channel;
  const name = channel.slice(1);
  const data = await slackFetch(token, "conversations.list?limit=200&types=public_channel,private_channel");
  const found = data.channels?.find((c: any) => c.name === name);
  if (!found) throw new Error(`Canal no encontrado: ${channel}`);
  return found.id;
}

export async function sendMessage(token: string, channel: string, text: string) {
  const id = await resolveChannel(token, channel);
  const res = await slackFetch(token, "chat.postMessage", { channel: id, text });
  return { ok: true, ts: res.ts };
}

export async function listMessages(token: string, channel: string, limit = 20) {
  const id = await resolveChannel(token, channel);
  const data = await slackFetch(token, `conversations.history?channel=${id}&limit=${limit}`);
  return (data.messages ?? []).map((m: any) => ({
    user: m.user,
    text: m.text,
    ts: m.ts,
  }));
}
