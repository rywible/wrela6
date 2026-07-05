import { describe, expect, test } from "bun:test";

import { parseWrelaManifest } from "../../../src/cli/manifest";

describe("W6-03a manifest parser", () => {
  test("rejects malformed key/value syntax instead of silently using defaults", () => {
    expect(() => parseWrelaManifest("[package]\nname = demo\n")).toThrow(
      "manifest:invalid-syntax:2",
    );
  });

  test("rejects unknown sections and keys as usage-facing manifest diagnostics", () => {
    expect(() => parseWrelaManifest('[unknown]\nname = "demo"\n')).toThrow(
      "manifest:unknown-section:1:unknown",
    );
    expect(() => parseWrelaManifest('[package]\nversion = "1"\n')).toThrow(
      "manifest:unknown-key:2:package.version",
    );
  });
});
