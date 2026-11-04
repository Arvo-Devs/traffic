// What the server reads from a request beyond its body: the visitor's
// address and country (from the app's own hooks, never from a header a
// caller can set), the user agent, whether the request came from one of the
// site's own pages, and the body up to a size.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { ResolvedTrafficConfig } from '../config';

export type RequestFacts = Readonly<{
  /** The visitor's address as the app's own proxy names it (config.clientIp). Null when unknown or not an address. */
  ip: string | null;
  userAgent: string | null;
  /** ISO country code from config.country, or null when unknown. */
  country: string | null;
}>;

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * An address as Postgres keeps it in inet, or null for anything that is not
 * one. An IPv4 address written as IPv6 (::ffff:203.0.113.7, what a
 * dual-stack socket reports) is the IPv4 address, so one connection is one
 * visitor and one limit however the proxy wrote it.
 */
export function clientAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const address = MAPPED_IPV4.exec(trimmed)?.[1] ?? trimmed;
  // A zone id (fe80::1%en0) is an address to Node and an error to inet.
  return isIP(address) && !address.includes('%') ? address : null;
}

/** An ISO 3166 code in upper case, or null. XX is Cloudflare's "unknown" and T1 is Tor: neither is a country. */
export function countryCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
}

type FactHooks = Pick<ResolvedTrafficConfig, 'clientIp' | 'country'>;

/** The visitor's address, the one every per-address limit counts by. */
export function addressOf(request: Request, config: Pick<ResolvedTrafficConfig, 'clientIp'>): string | null {
  return clientAddress(config.clientIp(request));
}

/** What the server knows about a request beyond the note itself. */
export function requestFacts(request: Request, config: FactHooks): RequestFacts {
  return {
    ip: addressOf(request, config),
    userAgent: request.headers.get('user-agent')?.trim().slice(0, 512) || null,
    country: countryCode(config.country(request)),
  };
}

/** One browser on one connection: the same address and the same user agent. */
export function visitorKey(ip: string | null, userAgent: string | null): string {
  return createHash('sha256').update(`${ip ?? 'no-address'}|${userAgent ?? ''}`).digest('hex').slice(0, 32);
}

/**
 * True when the request came from one of the site's own pages, or names no
 * origin and does not say it is cross-site, as some beacons do. `siteHosts`
 * are host names; the port is not compared.
 */
export function fromOwnPage(headers: Headers, siteHosts: readonly string[]): boolean {
  const origin = headers.get('origin');
  if (!origin) return headers.get('sec-fetch-site') !== 'cross-site';
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return siteHosts.some((own) => own.trim().toLowerCase() === host);
}

/** Reads the body up to `max` bytes; null when it is longer. */
export async function readTextUpTo(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
