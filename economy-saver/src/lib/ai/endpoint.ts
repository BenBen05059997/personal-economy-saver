import { InputError } from "@/db/input-error";
import { isIP } from "node:net";

const BAD = "That address can't be used: ";
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const stripDot = (host: string) => host.toLowerCase().replace(/\.$/, "");

/** True only when the app itself runs on this machine, so a model on this machine is reachable and meaningful. */
export const localAllowed = (appUrl: URL) => {
  const host = stripDot(appUrl.hostname);
  return LOCAL_NAMES.has(host) || host.endsWith(".localhost");
};

function privateV4(a: number, b: number, c = 1): boolean {
  return (a === 192 && b === 0 && c <= 2) // 192.0.0.0/24 and 192.0.2.0/24
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // documentation ranges
    || a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) // 198.18.0.0/15 benchmarking
    || a >= 224; // 224+ is multicast, reserved, broadcast
}

/** The eight 16-bit groups of a WHATWG-normalised IPv6 literal (compressed, hex; an embedded dotted v4 is already hex). */
function groupsOf(bare: string): number[] {
  const [head, tail] = bare.split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map(g => parseInt(g, 16));
}

/** True for loopback, private, link-local, CGNAT, unspecified and multicast addresses, v4 and v6 (mapped, compatible, NAT64, 6to4, site-local). */
function privateIp(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(bare) === 4) { const [a, b, c] = bare.split(".").map(Number); return privateV4(a, b, c); }
  if (isIP(bare) !== 6) return false;
  const g = groupsOf(bare);
  if (g.length !== 8 || g.some(Number.isNaN)) return true; // unreadable: refuse
  const embedded = () => privateV4(g[6] >> 8, g[6] & 255);
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0 || g[5] === 0xffff)) return embedded(); // ::, ::1, ::a.b.c.d (compatible), ::ffff:a.b.c.d (mapped)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x2002) return true; // 6to4 2002::/16
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

/**
 * The address the server will call, normalised (no trailing slash), or an InputError a person can read.
 * https and a public host only; `http://localhost` / 127.0.0.1 / [::1] only when allowLocal (the app itself runs locally).
 */
export function checkBaseUrl(input: string, opts: { allowLocal: boolean }): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new InputError(BAD + "it is not a web address."); }
  if (url.username || url.password) throw new InputError(BAD + "it must not contain a user name or password.");
  if (url.search || url.hash) throw new InputError(BAD + "it must not contain a query or a #fragment.");
  const host = stripDot(url.hostname);
  if (opts.allowLocal && url.protocol === "http:" && LOCAL_NAMES.has(host)) return url.href.replace(/\/+$/, "");
  if (url.protocol !== "https:") throw new InputError(BAD + "it must start with https://.");
  if (host === "localhost" || /\.(local|internal|localhost)$/.test(host) || privateIp(host)) {
    throw new InputError(BAD + "it points to this machine or a private network.");
  }
  return url.href.replace(/\/+$/, "");
}
