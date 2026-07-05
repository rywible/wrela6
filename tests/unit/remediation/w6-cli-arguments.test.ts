import { describe, expect, test } from "bun:test";
import { parseWrelaCliArguments } from "../../../src/cli/arguments";

describe("W6 CLI argument parser", () => {
  test("parses build flags without touching the filesystem", () => {
    const result = parseWrelaCliArguments([
      "build",
      "demo",
      "--target",
      "uefi-aarch64-rpi5",
      "--out",
      "image.efi",
      "--emit",
      "image",
      "--stdlib",
      "ejected",
      "--json",
    ]);

    expect(result).toEqual({
      kind: "build",
      directory: "demo",
      target: "uefi-aarch64-rpi5",
      out: "image.efi",
      emit: "image",
      stdlibMode: "ejected",
      json: true,
    });
  });

  test("parses init with the production target alias", () => {
    const result = parseWrelaCliArguments(["init", "--target", "uefi-aarch64", "demo"]);

    expect(result).toEqual({
      kind: "init",
      directory: "demo",
      target: "uefi-aarch64",
      json: false,
    });
  });

  test("rejects build flags whose value is another flag", () => {
    const result = parseWrelaCliArguments(["build", "demo", "--out", "--json"]);

    expect(result).toEqual({
      kind: "usage-error",
      json: true,
      stableDetail: "cli:missing-value:--out",
    });
  });

  test("rejects multiple init directories instead of silently picking the last one", () => {
    const result = parseWrelaCliArguments(["init", "--target", "uefi-aarch64", "first", "second"]);

    expect(result).toEqual({
      kind: "usage-error",
      json: false,
      stableDetail: "cli:init:too-many-directories",
    });
  });

  test("rejects run without the explicit qemu opt-in", () => {
    const result = parseWrelaCliArguments(["run", "demo"]);

    expect(result).toEqual({
      kind: "usage-error",
      json: false,
      stableDetail: "cli:run:missing-qemu",
    });
  });
});
