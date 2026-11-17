import { describe, expect, it } from "vitest";
import { redactSecrets, redactString, REDACTED } from "../src/utils/redact";

describe("redactString URL userinfo", () => {
  it("masks a password containing an at-sign without leaking its tail", () => {
    const redacted = redactString("rtsp://operator:p@ss@camera.example:554/live");

    expect(redacted).toBe("rtsp://***@camera.example:554/live");
    expect(redacted).not.toContain("p@ss");
    expect(redacted).not.toContain("ss@camera");
  });

  it("masks an embedded source inside an error message", () => {
    const redacted = redactString(
      "AI capture failed for source 'rtsp://operator:p@ss@camera.example/live': 502",
    );

    expect(redacted).not.toContain("p@ss");
    expect(redacted).toContain("'rtsp://***@camera.example/live'");
  });

  it("leaves an at-sign in a path alone", () => {
    const value = "https://example.com/@alice";

    expect(redactString(value)).toBe(value);
  });
});

describe("redactSecrets sensitive object properties", () => {
  it("masks nested objects and arrays stored under sensitive keys", () => {
    const input = {
      password: { current: "plain-text-secret" },
      credentials: [{ username: "camera-user", password: "camera-secret" }],
      nested: { apiKey: ["key-one", "key-two"] },
    };
    expect(redactSecrets(input)).toEqual({
      password: REDACTED,
      credentials: REDACTED,
      nested: { apiKey: REDACTED },
    });
  });

  it("keeps ordinary non-sensitive object properties intact", () => {
    const input = { camera: { id: "cam-1", status: "online" } };
    expect(redactSecrets(input)).toEqual(input);
  });
});
