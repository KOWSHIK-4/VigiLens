/**
 * Outbound URL guard for backend-initiated requests to operator-supplied
 * camera URLs.
 *
 * Camera source URLs are tenant-controlled, and the backend dereferences them
 * during a health check. That is a server-side request forgery primitive: a
 * tenant admin can aim a camera at an address the backend can reach but they
 * cannot, and the response status is reflected back in the health message,
 * which turns the camera list into a port scanner for the internal network.
 *
 * The obvious fix -- refuse every private address -- is not available here.
 * On-premise camera deployments live on exactly those ranges, and `10.0.0.x`
 * is the single most common way this product gets deployed. Blocking RFC1918
 * space would break the primary use case.
 *
 * So this guard blocks only the destinations that can never be a camera and
 * are always an attack:
 *
 *   - loopback (127.0.0.0/8, ::1) -- a camera is not on the API host itself
 *   - link-local (169.254.0.0/16, fe80::/10) -- includes the cloud instance
 *     metadata endpoint (169.254.169.254, fd00:ec2::254), which is how a
 *     naive SSRF turns into cloud credential theft
 *   - the well-known metadata hostnames
 *
 * Everything else, including all RFC1918 space, stays permitted.
 *
 * Known residual risk, deliberately not addressed here: `fetch` resolves DNS
 * itself and follows redirects, so a hostname that resolves to a blocked
 * address (DNS rebinding), or an allowed host that 302s to a blocked address,
 * still reaches the target. Closing that requires pinning the resolved IP and
 * re-validating each hop, which conflicts with cameras that legitimately sit
 * behind redirects. Worth revisiting if the threat model demands it.
 */

/** Hostnames that are always an SSRF target, never a camera. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

/**
 * Blocked IPv4 ranges as [network, prefixLength, label]. Kept as literal
 * integers so there is no dependency and no `ipaddr.js`-style edge cases with
 * shorthand notation.
 */
const BLOCKED_IPV4: Array<{ network: number; prefix: number; label: string }> = [
  { network: ipv4ToInt("127.0.0.0"), prefix: 8, label: "loopback" },
  { network: ipv4ToInt("169.254.0.0"), prefix: 16, label: "link-local/metadata" },
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  let value = 0;
  for (const part of parts) {
    value = (value * 256 + Number(part)) >>> 0;
  }
  return value >>> 0;
}

function matchesCidr(ipInt: number, network: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (network & mask) >>> 0;
}

function isBlockedIpv4(host: string): string | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const octets = host.split(".").map((o) => Number(o));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  const ipInt = ipv4ToInt(host);
  for (const range of BLOCKED_IPV4) {
    if (matchesCidr(ipInt, range.network, range.prefix)) return range.label;
  }
  return null;
}

function isBlockedIpv6(host: string): string | null {
  const normalized = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (normalized === "::1") return "loopback";
  // fe80::/10 -- link-local, same rationale as IPv4 link-local.
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return "link-local/metadata";
  // EC2 IMDSv6 endpoint, explicitly.
  if (normalized === "fd00:ec2::254") return "link-local/metadata";
  return null;
}

export interface UrlGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Returns whether the backend may dereference this URL on the tenant's behalf.
 * Non-HTTP schemes are rejected outright: the HTTP health-check branch only
 * ever runs for http/https, and handing `file:` or `gopher:` through to `fetch`
 * or the AI service has no legitimate reading.
 */
export function assertOutboundUrlAllowed(rawUrl: string): UrlGuardResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "Camera URL is not a valid absolute URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: `Unsupported camera URL scheme "${parsed.protocol}"` };
  }

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { allowed: false, reason: `Camera URL host "${host}" is not permitted` };
  }

  const ipv4Reason = isBlockedIpv4(host);
  if (ipv4Reason) {
    return {
      allowed: false,
      reason: `Camera URL resolves to a blocked address (${ipv4Reason})`,
    };
  }

  const ipv6Reason = isBlockedIpv6(host);
  if (ipv6Reason) {
    return {
      allowed: false,
      reason: `Camera URL resolves to a blocked address (${ipv6Reason})`,
    };
  }

  return { allowed: true };
}
