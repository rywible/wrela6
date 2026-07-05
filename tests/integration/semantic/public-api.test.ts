import { expect, test } from "bun:test";
import * as semantic from "../../../src/semantic";
import {
  buildItemIndex,
  checkSemanticSurface,
  itemId,
  moduleId,
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../src/semantic";

test("semantic namespace exports item-index API", () => {
  expect(semantic.buildItemIndex).toBeDefined();
  expect(semantic.ItemIndex).toBeDefined();
  expect(semantic.moduleId).toBeDefined();
  expect(buildItemIndex).toBeDefined();
  expect(typeof moduleId(0)).toBe("number");
  expect(typeof itemId(0)).toBe("number");
});

test("semantic namespace exports name-resolution API", () => {
  expect(semantic.resolveNames).toBeDefined();
  expect(semantic.CoreTypeCatalog).toBeDefined();
  expect(semantic.platformPrimitiveNameCatalog).toBeDefined();
  expect(semantic.buildMemberNamespace).toBeDefined();
  expect(semantic.buildModuleNamespace).toBeDefined();
});

test("semantic namespace exports semantic surface API", () => {
  expect(typeof checkSemanticSurface).toBe("function");
  expect(typeof platformPrimitiveCatalog).toBe("function");
  expect(typeof semanticTargetSurface).toBe("function");
  expect(typeof semantic.sortSemanticSurfaceDiagnostics).toBe("function");
  expect(semantic.CheckedProgramBuilder).toBeDefined();
});
