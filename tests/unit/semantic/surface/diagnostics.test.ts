import { expect, test } from "bun:test";
import { SourceText, SourceSpan } from "../../../../src/frontend";
import {
  ambiguousImageRoot,
  duplicateUniqueEdgeRoot,
  illegalFunctionModifiers,
  invalidTypeReference,
  missingImageRoot,
  platformPrimitiveSignatureMismatch,
  sortSemanticSurfaceDiagnostics,
} from "../../../../src/semantic/surface/diagnostics";
import { moduleId } from "../../../../src/semantic/ids";

test("diagnostics preserve narrow caller spans", () => {
  const source = SourceText.from("main.wr", "fn main(x: Missing)\n");
  const span = source.span(11, 18);

  const diagnostic = invalidTypeReference({
    source,
    span,
    order: { moduleId: moduleId(0), span, codeTieBreaker: "type" },
    typeName: "Missing",
  });

  expect(diagnostic.code).toBe("SURFACE_INVALID_TYPE_REFERENCE");
  expect(diagnostic.span).toEqual(span);
  expect(diagnostic.message).toContain("Missing");
});

test("diagnostics sort deterministically", () => {
  const source = SourceText.from("main.wr", "abc");
  const later = source.span(2, 3);
  const earlier = source.span(0, 1);

  const diagnostics = sortSemanticSurfaceDiagnostics([
    platformPrimitiveSignatureMismatch({
      source,
      span: later,
      order: { moduleId: moduleId(0), span: later, codeTieBreaker: "b" },
      functionName: "late",
      reason: "return type differs",
    }),
    invalidTypeReference({
      source,
      span: earlier,
      order: { moduleId: moduleId(0), span: earlier, codeTieBreaker: "a" },
      typeName: "Early",
    }),
  ]);

  expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "SURFACE_INVALID_TYPE_REFERENCE",
    "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
  ]);
});

test("duplicateUniqueEdgeRoot includes related information", () => {
  const source = SourceText.from("main.wr", "abc");
  const span = source.span(0, 1);

  const diagnostic = duplicateUniqueEdgeRoot("pci-root", "dev2", "dev1", span, source, {
    moduleId: moduleId(0),
    span,
    codeTieBreaker: "a",
  });

  expect(diagnostic.code).toBe("SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT");
  expect(diagnostic.relatedInformation).toHaveLength(1);
});

test("missingImageRoot can be created without span or source", () => {
  const diagnostic = missingImageRoot(undefined, undefined, {
    moduleId: moduleId(0),
    span: SourceSpan.from(0, 0),
    codeTieBreaker: "a",
  });

  expect(diagnostic.code).toBe("SURFACE_MISSING_IMAGE_ROOT");
  expect(diagnostic.span).toBeUndefined();
  expect(diagnostic.source).toBeUndefined();
});

test("ambiguousImageRoot includes candidate names", () => {
  const source = SourceText.from("main.wr", "abc");
  const span = source.span(0, 1);

  const diagnostic = ambiguousImageRoot(["Boot", "Recovery"], span, source, {
    moduleId: moduleId(0),
    span,
    codeTieBreaker: "a",
  });

  expect(diagnostic.code).toBe("SURFACE_AMBIGUOUS_IMAGE_ROOT");
  expect(diagnostic.message).toContain("Boot");
  expect(diagnostic.message).toContain("Recovery");
});

test("illegalFunctionModifiers includes details in message", () => {
  const source = SourceText.from("main.wr", "abc");
  const span = source.span(0, 1);

  const diagnostic = illegalFunctionModifiers("platform and constructor combined", span, source, {
    moduleId: moduleId(0),
    span,
    codeTieBreaker: "a",
  });

  expect(diagnostic.code).toBe("SURFACE_ILLEGAL_FUNCTION_MODIFIERS");
  expect(diagnostic.message).toContain("platform and constructor combined");
});
