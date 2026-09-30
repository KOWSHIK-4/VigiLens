/**
 * Audit IP attribution.
 *
 * Audit rows record who did what and from where. If the address can be chosen
 * by the caller, that field carries no evidentiary weight, so these tests pin
 * the property that matters: a request that lies in `X-Forwarded-For` is still
 * recorded under an address we chose, not one it picked.
 */

import { describe, expect, it } from "vitest";
import { clientInfo, clientIp } from "../src/utils/clientInfo";

type Req = Parameters<typeof clientIp>[0];

function makeReq(overrides: Record<string, unknown> = {}): Req {
  return {
    ip: undefined,
    headers: {},
    socket: { remoteAddress: "" },
    ...overrides,
  } as unknown as Req;
}

describe("clientIp", () => {
  it("prefers the proxy-resolved address over a spoofed forwarding header", () => {
    const req = makeReq({
      ip: "203.0.113.9",
      headers: { "x-forwarded-for": "10.0.0.1" },
      socket: { remoteAddress: "172.18.0.4" },
    });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("ignores a client-supplied X-Forwarded-For entirely", () => {
    // The realistic attack: reach the API and claim to be an internal address,
    // or claim to be the victim of an action being investigated.
    const req = makeReq({
      ip: "198.51.100.4",
      headers: { "x-forwarded-for": "127.0.0.1, 10.0.0.5, 192.168.1.1" },
      socket: { remoteAddress: "172.18.0.4" },
    });
    expect(clientIp(req)).not.toContain("10.0.0.5");
    expect(clientIp(req)).toBe("198.51.100.4");
  });

  it("falls back to the socket address when no proxy resolved one", () => {
    const req = makeReq({
      headers: { "x-forwarded-for": "10.0.0.1" },
      socket: { remoteAddress: "172.18.0.4" },
    });
    expect(clientIp(req)).toBe("172.18.0.4");
  });

  it("returns an empty string when nothing is available", () => {
    expect(clientIp(makeReq())).toBe("");
  });

  it("does not throw on a request without a socket", () => {
    const req = makeReq({ socket: undefined });
    expect(clientIp(req)).toBe("");
  });
});

describe("clientInfo", () => {
  it("returns the trusted address with the user agent", () => {
    const req = makeReq({
      ip: "203.0.113.9",
      headers: { "x-forwarded-for": "10.0.0.1", "user-agent": "vigilens-cli/2" },
      socket: { remoteAddress: "172.18.0.4" },
    });
    expect(clientInfo(req)).toEqual({ ipAddress: "203.0.113.9", userAgent: "vigilens-cli/2" });
  });

  it("defaults the user agent to an empty string", () => {
    const req = makeReq({ ip: "203.0.113.9" });
    expect(clientInfo(req).userAgent).toBe("");
  });

  it("ignores a non-string user agent header", () => {
    const req = makeReq({ ip: "203.0.113.9", headers: { "user-agent": ["a", "b"] } });
    expect(clientInfo(req).userAgent).toBe("");
  });
});
