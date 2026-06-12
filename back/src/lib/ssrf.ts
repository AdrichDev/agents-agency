/**
 * Guard SSRF para fetches de URLs influenciadas por el usuario o la IA.
 *
 * assertPublicUrl: valida esquema http/https y resuelve DNS, rechazando si
 * cualquier IP resuelta es loopback/privada/link-local/unique-local/metadata.
 *
 * safeFetch: wrapper sobre fetch que re-valida la URL, desactiva redirecciones
 * (las sigue manualmente revalidando cada salto), aplica timeout y un tope de
 * tamaño de respuesta.
 */

import dns from "node:dns";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 3;

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** Convierte una IPv4 en su entero de 32 bits. */
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inV4Cidr(ip: string, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** ¿Es una IPv4 privada/loopback/link-local/metadata/no enrutable? */
function isBlockedIPv4(ip: string): boolean {
  return (
    inV4Cidr(ip, "0.0.0.0", 8) || // "este" host / 0.0.0.0
    inV4Cidr(ip, "127.0.0.0", 8) || // loopback
    inV4Cidr(ip, "10.0.0.0", 8) || // privada
    inV4Cidr(ip, "172.16.0.0", 12) || // privada
    inV4Cidr(ip, "192.168.0.0", 16) || // privada
    inV4Cidr(ip, "169.254.0.0", 16) || // link-local (incluye 169.254.169.254 metadata)
    inV4Cidr(ip, "100.64.0.0", 10) || // CGNAT
    inV4Cidr(ip, "192.0.0.0", 24) ||
    inV4Cidr(ip, "192.0.2.0", 24) ||
    inV4Cidr(ip, "198.18.0.0", 15) ||
    inV4Cidr(ip, "240.0.0.0", 4) // reservado
  );
}

/** ¿Es una IPv6 bloqueada (loopback, ULA, link-local, mapeada a IPv4 privada)? */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // IPv4-mapeada (::ffff:a.b.c.d) → validar la parte IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (lower.startsWith("fe80")) return true; // link-local
  // unique-local fc00::/7 → primer byte 0xfc o 0xfd
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

/** ¿La IP (v4 o v6) está en un rango bloqueado? */
export function isBlockedAddress(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return isBlockedIPv4(ip);
  if (type === 6) return isBlockedIPv6(ip);
  return true; // no parseable → bloquear por seguridad
}

const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

/**
 * Valida que una URL apunte a un destino público.
 * Lanza SsrfError si el esquema no es http/https o si alguna IP resuelta
 * por DNS es privada/loopback/link-local/metadata.
 * Devuelve el objeto URL parseado.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`URL no válida: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Esquema no permitido: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // quita corchetes IPv6
  if (METADATA_HOSTS.has(hostname.toLowerCase())) {
    throw new SsrfError("Host de metadatos bloqueado");
  }

  // Si el host ya es una IP literal, validar directamente
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfError(`IP no pública bloqueada: ${hostname}`);
    }
    return url;
  }

  // Resolver DNS: TODAS las direcciones deben ser públicas
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new SsrfError(`No se pudo resolver el host: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new SsrfError(`Host sin direcciones: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfError(`El host ${hostname} resuelve a una IP no pública (${address})`);
    }
  }

  return url;
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
  /** Por defecto false: no se siguen redirecciones automáticas (SSRF). */
  allowRedirects?: boolean;
}

/**
 * Fetch endurecido contra SSRF: revalida la URL, desactiva las redirecciones
 * automáticas de fetch (las sigue manualmente revalidando cada salto si
 * allowRedirects=true), aplica timeout y tope de bytes de respuesta.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    allowRedirects = false,
    ...init
  } = options;

  let currentUrl = rawUrl;
  let redirects = 0;

  while (true) {
    await assertPublicUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Manejo manual de redirecciones (revalidando cada salto)
    if (res.status >= 300 && res.status < 400 && res.headers?.has?.("location")) {
      if (!allowRedirects) {
        throw new SsrfError("Redirección bloqueada");
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new SsrfError("Demasiadas redirecciones");
      }
      const location = res.headers.get("location")!;
      currentUrl = new URL(location, currentUrl).toString();
      redirects++;
      continue;
    }

    // Tope de tamaño: por Content-Length declarado…
    const declared = Number(res.headers?.get?.("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SsrfError(`Respuesta demasiado grande (${declared} bytes)`);
    }

    // …y por streaming real (si no hay Content-Length o miente)
    return enforceMaxBytes(res, maxBytes);
  }
}

/** Envuelve la respuesta forzando un tope de bytes durante la lectura del body. */
function enforceMaxBytes(res: Response, maxBytes: number): Response {
  if (!res.body) return res;
  const reader = res.body.getReader();
  let received = 0;

  const limited = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        controller.error(new SsrfError(`Respuesta excede ${maxBytes} bytes`));
        reader.cancel().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(limited, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
