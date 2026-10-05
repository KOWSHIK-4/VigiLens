/**
 * Outbound camera-URL guard.
 *
 * The security value here is blocking the destinations that can only be an
 * SSRF attempt. The regression risk is over-blocking: this product is deployed
 * on-premise, where cameras sit on RFC1918 addresses, so a guard that refuses
 * 10.x / 192.168.x would be a real outage. Both directions are pinned below.
 */

import { describe, expect, it } from "vitest";
import { assertCameraSourceAllowed, assertOutboundUrlAllowed } from "../src/utils/ssrf";

describe("assertOutboundUrlAllowed", () => {
  describe("blocks SSRF targets", () => {
    it("blocks the cloud metadata endpoint", () => {
      const result = assertOutboundUrlAllowed("http://169.254.169.254/latest/meta-data/");
      expect(result.allowed).toBe(false);
    });

    it("blocks loopback by IP", () => {
      expect(assertOutboundUrlAllowed("http://127.0.0.1:5432/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://127.0.0.53/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("https://127.1.2.3/").allowed).toBe(false);
    });

    it("blocks loopback by name", () => {
      expect(assertOutboundUrlAllowed("http://localhost:3000/admin").allowed).toBe(false);
      expect(
        assertOutboundUrlAllowed("http://metadata.google.internal/computeMetadata/v1/").allowed,
      ).toBe(false);
    });

    it("blocks IPv6 loopback and IMDS", () => {
      expect(assertOutboundUrlAllowed("http://[::1]:8080/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://[fd00:ec2::254]/latest/").allowed).toBe(false);
    });

    it("blocks IPv4-mapped IPv6 literals, which is how loopback and IMDS hide", () => {
      // `new URL()` normalises these to hex form before the guard reads them,
      // so the IPv4 rules only fire if the mapped form is unpacked first. Both
      // spellings are listed because the dotted form is what a tenant types.
      expect(assertOutboundUrlAllowed("http://[::ffff:127.0.0.1]/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://[::ffff:7f00:1]:8080/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://[::ffff:169.254.169.254]/latest/").allowed).toBe(
        false,
      );
      expect(assertOutboundUrlAllowed("http://[::ffff:a9fe:a9fe]/latest/").allowed).toBe(false);
    });

    it("blocks the unspecified addresses, which are aliases for loopback", () => {
      // Neither 0.0.0.0 nor :: is inside a blocked CIDR, but the OS routes both
      // to localhost, so leaving them open hands out the API host.
      expect(assertOutboundUrlAllowed("http://0.0.0.0:8080/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://[::]/").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://[::ffff:0.0.0.0]/").allowed).toBe(false);
    });

    it("blocks non-HTTP schemes", () => {
      expect(assertOutboundUrlAllowed("file:///etc/passwd").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("gopher://127.0.0.1:11211/").allowed).toBe(false);
    });

    it("blocks malformed URLs", () => {
      expect(assertOutboundUrlAllowed("not a url").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("").allowed).toBe(false);
    });

    it("explains why it blocked", () => {
      const result = assertOutboundUrlAllowed("http://169.254.169.254/");
      expect(result.reason).toBeTruthy();
    });
  });

  describe("still allows real camera deployments", () => {
    it("allows RFC1918 addresses -- the primary on-prem deployment", () => {
      // These are the addresses this product is actually installed against.
      // If any of these ever get blocked, the product is broken, not safer.
      expect(assertOutboundUrlAllowed("http://10.0.0.42:8080/stream").allowed).toBe(true);
      expect(assertOutboundUrlAllowed("http://192.168.1.100/").allowed).toBe(true);
      expect(assertOutboundUrlAllowed("http://172.16.4.9/cgi-bin/stream").allowed).toBe(true);
    });

    it("allows 172.32.x, just outside the RFC1918 172.16-31 block", () => {
      expect(assertOutboundUrlAllowed("http://172.32.0.1/").allowed).toBe(true);
    });

    it("allows public addresses and camera hostnames", () => {
      expect(assertOutboundUrlAllowed("https://cam.example.com/live").allowed).toBe(true);
      expect(assertOutboundUrlAllowed("http://203.0.113.10/").allowed).toBe(true);
    });

    it("allows credentials and ports in the URL", () => {
      expect(assertOutboundUrlAllowed("http://admin:secret@10.0.0.5:8080/").allowed).toBe(true);
    });

    it("still allows mapped IPv6 addresses that are not blocked", () => {
      // Unpacking the mapped form must not turn into a blanket IPv6 deny: a
      // camera on an RFC1918 address is the primary deployment and may be
      // written in either spelling.
      expect(assertOutboundUrlAllowed("http://[::ffff:10.0.0.42]:8080/").allowed).toBe(true);
      expect(assertOutboundUrlAllowed("http://[::ffff:a00:a2a]/").allowed).toBe(true);
      expect(assertCameraSourceAllowed("rtsp://[::ffff:192.168.1.100]:554/live").allowed).toBe(
        true,
      );
    });

    it("is case-insensitive about the hostname", () => {
      expect(assertOutboundUrlAllowed("http://LOCALHOST/x").allowed).toBe(false);
      expect(assertOutboundUrlAllowed("http://MetaData.Google.Internal/x").allowed).toBe(false);
    });
  });
});
