import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { stableDigestHex, stableJson } from "../../../src/shared/stable-json";

describe("stableJson", () => {
  test("stableDigestHex computes real SHA-256 over stable JSON", () => {
    const value = { beta: 2, alpha: 1, nested: { z: 3, a: 4 } };
    const expected = createHash("sha256").update(stableJson(value), "utf8").digest("hex");

    expect(stableDigestHex(value)).toBe(expected);
    expect(stableDigestHex(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("stableDigestHex orders object keys by code unit", () => {
    expect(stableJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
