export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return res.json();
}
