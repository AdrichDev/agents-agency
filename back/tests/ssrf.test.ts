import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de dns para controlar la resolución por host en assertPublicUrl.
vi.mock("node:dns", () => {
  const lookup = vi.fn();
  return { default: { promises: { lookup } }, promises: { lookup } };
});

import dns from "node:dns";
import { assertPublicUrl, isBlockedAddress, SsrfError } from "@/lib/ssrf";

const mockLookup = (dns as any).promises.lookup as ReturnType<typeof vi.fn>;

function resolvesTo(...ips: string[]) {
  mockLookup.mockResolvedValue(ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

describe("isBlockedAddress", () => {
  it("bloquea loopback, privadas, link-local y metadata", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("172.16.5.5")).toBe(true);
    expect(isBlockedAddress("192.168.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("permite IPs públicas", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  beforeEach(() => mockLookup.mockReset());

  it("rechaza esquemas no http/https", async () => {
    await expect(assertPublicUrl("ftp://example.com")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rechaza IP loopback literal sin DNS", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toBeInstanceOf(SsrfError);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rechaza el host de metadatos 169.254.169.254", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rechaza 10.x literal", async () => {
    await expect(assertPublicUrl("http://10.0.0.5/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rechaza un host que resuelve por DNS a una IP privada", async () => {
    resolvesTo("192.168.1.50");
    await expect(assertPublicUrl("http://internal.corp.local/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rechaza si CUALQUIER IP resuelta es privada (rebinding)", async () => {
    resolvesTo("8.8.8.8", "127.0.0.1");
    await expect(assertPublicUrl("http://mixed.example/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("permite un host que resuelve a una IP pública", async () => {
    resolvesTo("93.184.216.34");
    const url = await assertPublicUrl("https://example.com/path");
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe("example.com");
  });
});
