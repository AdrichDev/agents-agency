/**
 * DNS rebinding in `safeFetch`.
 *
 * `assertPublicUrl` resolves the host and checks every address, but `fetch` used to resolve
 * the host AGAIN when opening the socket. A domain with a zero TTL can answer a public IP to
 * the check and `127.0.0.1` to the connection (time-of-check / time-of-use), reaching
 * internal services. The fix validates the addresses inside the connection's own lookup, so
 * the socket only ever opens to an address that passed the guard.
 *
 * Hermetic: `node:dns` is mocked; a local server stands in for the internal service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("node:dns", () => {
  const lookup = vi.fn();
  return { default: { promises: { lookup } }, promises: { lookup } };
});

import dns from "node:dns";
import { guardedLookup, safeFetch, SsrfError } from "@/lib/ssrf";

const mockLookup = (dns as any).promises.lookup as ReturnType<typeof vi.fn>;

function lookupOnce(...ips: string[]) {
  mockLookup.mockResolvedValueOnce(ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

function callLookup(hostname: string, options: { all?: boolean }) {
  return new Promise<{ err: unknown; result: unknown; family?: number }>((resolve) => {
    guardedLookup(hostname, options, (err: unknown, result?: unknown, family?: number) =>
      resolve({ err, result, family })
    );
  });
}

beforeEach(() => {
  mockLookup.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guardedLookup (connection-time resolution)", () => {
  it("rejects when the connection resolves to a private address", async () => {
    lookupOnce("93.184.216.34", "127.0.0.1");
    const { err } = await callLookup("rebind.test", { all: true });
    expect(err).toBeInstanceOf(SsrfError);
  });

  it("returns every public address when asked for all of them", async () => {
    lookupOnce("93.184.216.34", "2606:2800:220:1::1");
    const { err, result } = await callLookup("public.test", { all: true });
    expect(err).toBeNull();
    expect(result).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
  });

  it("returns the first address and its family in single-address mode", async () => {
    lookupOnce("93.184.216.34");
    const { err, result, family } = await callLookup("public.test", {});
    expect(err).toBeNull();
    expect(result).toBe("93.184.216.34");
    expect(family).toBe(4);
  });

  it("turns a resolution failure into an SsrfError", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const { err } = await callLookup("missing.test", { all: true });
    expect(err).toBeInstanceOf(SsrfError);
  });
});

describe("safeFetch against a rebinding host", () => {
  it("never connects when the second resolution points at loopback", async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end("internal secret");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as AddressInfo;

    lookupOnce("93.184.216.34"); // the check sees a public address…
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]); // …the socket gets loopback

    try {
      await expect(safeFetch(`http://rebind.test:${port}/`)).rejects.toBeInstanceOf(SsrfError);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("sends every request through the pinned dispatcher", async () => {
    lookupOnce("93.184.216.34");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await safeFetch("https://public.test/");

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeDefined();
  });
});
