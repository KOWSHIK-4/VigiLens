import { describe, expect, it } from "vitest";
import { redactSecrets, REDACTED } from "../src/utils/redact";

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
