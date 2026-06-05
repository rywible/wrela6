import { describe, expect, test } from "bun:test";
import { DottedModuleResolver } from "../../../../src/frontend/lexer/module-resolver";
import { ModulePath } from "../../../../src/frontend/lexer/module-path";
import { SourceText } from "../../../../src/frontend/lexer/source-text";

describe("ModulePath", () => {
  test("normalizes duplicate slashes and leading dot-slash", () => {
    const modulePath = ModulePath.from("./core//uefi.wr");
    expect(modulePath.key).toBe("core/uefi.wr");
  });

  test("normalizes backslashes to forward slashes", () => {
    const modulePath = ModulePath.from("core\\uefi.wr");
    expect(modulePath.key).toBe("core/uefi.wr");
  });

  test("rejects parent directory traversal", () => {
    expect(() => ModulePath.from("../secrets.wr")).toThrow();
  });

  test("rejects absolute paths", () => {
    expect(() => ModulePath.from("/tmp/secrets.wr")).toThrow();
  });

  test("rejects empty paths", () => {
    expect(() => ModulePath.from("")).toThrow();
  });

  test("rejects paths with NUL bytes", () => {
    expect(() => ModulePath.from("core\0/uefi.wr")).toThrow();
  });

  test("rejects Windows drive prefixes", () => {
    expect(() => ModulePath.from("C:/core/uefi.wr")).toThrow();
  });

  test("rejects trailing slash producing empty segment", () => {
    expect(() => ModulePath.from("core/uefi/")).toThrow();
  });

  test("equals compares by normalized key", () => {
    const first = ModulePath.from("./core//uefi.wr");
    const second = ModulePath.from("core/uefi.wr");
    expect(first.equals(second)).toBe(true);
  });

  test("equals returns false for different paths", () => {
    const first = ModulePath.from("core/uefi.wr");
    const second = ModulePath.from("app/main.wr");
    expect(first.equals(second)).toBe(false);
  });
});

describe("DottedModuleResolver", () => {
  test("resolves dotted module names to normalized files", () => {
    const resolver = new DottedModuleResolver();
    const source = SourceText.from("app/main.wr", "use Uefi from core.uefi\n");

    const result = resolver.resolve({
      importer: ModulePath.from("app/main.wr"),
      source,
      moduleName: "core.uefi",
      span: source.span(14, 23),
    });

    if (result.kind !== "resolved") {
      throw new Error(result.reason);
    }

    expect(result.path.key).toBe("core/uefi.wr");
  });

  test("resolves app.main to app/main.wr", () => {
    const resolver = new DottedModuleResolver();
    const source = SourceText.from("entry.wr", "");

    const result = resolver.resolve({
      importer: ModulePath.from("entry.wr"),
      source,
      moduleName: "app.main",
      span: source.span(0, 0),
    });

    if (result.kind !== "resolved") {
      throw new Error(result.reason);
    }

    expect(result.path.key).toBe("app/main.wr");
  });

  test("returns unresolved for empty module name", () => {
    const resolver = new DottedModuleResolver();
    const source = SourceText.from("entry.wr", "");

    const result = resolver.resolve({
      importer: ModulePath.from("entry.wr"),
      source,
      moduleName: "",
      span: source.span(0, 0),
    });

    expect(result.kind).toBe("unresolved");
  });

  test("returns unresolved for invalid module name with special characters", () => {
    const resolver = new DottedModuleResolver();
    const source = SourceText.from("entry.wr", "");

    const result = resolver.resolve({
      importer: ModulePath.from("entry.wr"),
      source,
      moduleName: "core..uefi",
      span: source.span(0, 0),
    });

    expect(result.kind).toBe("unresolved");
  });

  test("returns unresolved for module name with invalid characters", () => {
    const resolver = new DottedModuleResolver();
    const source = SourceText.from("entry.wr", "");

    const result = resolver.resolve({
      importer: ModulePath.from("entry.wr"),
      source,
      moduleName: "core/uefi",
      span: source.span(0, 0),
    });

    expect(result.kind).toBe("unresolved");
  });
});
