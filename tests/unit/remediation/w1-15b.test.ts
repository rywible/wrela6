import { expect, test } from "bun:test";
import type { ModuleImportRequest } from "../../../src/frontend/lexer/module-import-request";
import { ModulePath } from "../../../src/frontend/lexer/module-path";
import { DottedModuleResolver } from "../../../src/frontend/lexer/module-resolver";
import { SourceText } from "../../../src/frontend/lexer/source-text";

test("module path validation returns invalid results for user-controlled paths", () => {
  const invalidPaths = ["core\0/evil.wr", "/tmp/evil.wr", "../evil.wr", "C:/evil.wr"];

  for (const source of invalidPaths) {
    expect(() => ModulePath.tryFrom(source)).not.toThrow();

    const result = ModulePath.tryFrom(source);

    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.path).toBe(source);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  }
});

test("resolver returns path-invalid result without throwing", () => {
  const resolver = new DottedModuleResolver({
    modulePathFromFilePath: (filePath) => ModulePath.tryFrom(`../${filePath}`),
  });
  const source = SourceText.from("app/main.wr", "use Evil from evil\n");
  const request: ModuleImportRequest = {
    importer: ModulePath.from("app/main.wr"),
    source,
    moduleName: "evil",
    span: source.span(14, 18),
  };

  expect(() => resolver.resolve(request)).not.toThrow();

  const result = resolver.resolve(request);

  expect(result).toMatchObject({
    kind: "pathInvalid",
    path: "../evil.wr",
    ownerKey: "module-path:app/main.wr:evil:14:18",
    stableDetail: "module-path:invalid:evil:../evil.wr",
  });
});
