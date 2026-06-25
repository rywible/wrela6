import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { HirDiagnosticSink } from "../../../src/hir/diagnostics";
import { buildHirReferenceLookup } from "../../../src/hir/reference-lookup";
import { ResolvedReferencesBuilder } from "../../../src/semantic/names";
import type { SyntaxReferenceKey } from "../../../src/semantic/names/reference";
import { fieldId, functionId, itemId, moduleId, typeId } from "../../../src/semantic/ids";

function key(): SyntaxReferenceKey {
  return {
    moduleId: moduleId(0),
    span: SourceSpan.from(1, 5),
    kind: "functionName",
    ordinal: 0,
  };
}

test("reference lookup reports checked input disagreements deterministically", () => {
  const references = new ResolvedReferencesBuilder();
  const syntaxKey = key();
  references.add(syntaxKey, { kind: "type", itemId: itemId(1), typeId: typeId(1) });
  const diagnostics = new HirDiagnosticSink();

  buildHirReferenceLookup({
    references: references.build(),
    completedMembers: {
      get: () => ({ kind: "field", ownerItemId: itemId(1), fieldId: fieldId(1) }),
      entries: () => [
        {
          key: syntaxKey,
          reference: { kind: "field", ownerItemId: itemId(1), fieldId: fieldId(1) },
        },
      ],
    },
    requirementReferences: [],
    diagnostics,
  });

  expect(diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toEqual([
    "HIR_INPUT_SURFACE_DISAGREEMENT",
  ]);
});

test("reference lookup exposes ordinary completed and requirement references", () => {
  const references = new ResolvedReferencesBuilder();
  const syntaxKey = key();
  references.add(syntaxKey, { kind: "type", itemId: itemId(1), typeId: typeId(1) });
  const lookup = buildHirReferenceLookup({
    references: references.build(),
    completedMembers: {
      get: () => undefined,
      entries: () => [],
    },
    requirementReferences: [
      {
        key: syntaxKey,
        reference: { kind: "type", itemId: itemId(1), typeId: typeId(1) },
      },
    ],
    diagnostics: new HirDiagnosticSink(),
  });

  expect(lookup.referenceFor(syntaxKey)?.kind).toBe("type");
  expect(lookup.requirementReferenceFor(syntaxKey)?.kind).toBe("type");
});

test("span lookup keeps same-span references separated by module and kind", () => {
  const references = new ResolvedReferencesBuilder();
  const span = SourceSpan.from(1, 5);
  references.add(
    { moduleId: moduleId(0), span, kind: "functionName", ordinal: 0 },
    { kind: "function", itemId: itemId(0), functionId: functionId(0) },
  );
  references.add(
    { moduleId: moduleId(1), span, kind: "functionName", ordinal: 0 },
    { kind: "function", itemId: itemId(1), functionId: functionId(1) },
  );
  references.add(
    { moduleId: moduleId(1), span, kind: "typeName", ordinal: 0 },
    { kind: "type", itemId: itemId(2), typeId: typeId(2) },
  );

  const lookup = buildHirReferenceLookup({
    references: references.build(),
    completedMembers: {
      get: () => undefined,
      entries: () => [],
    },
    requirementReferences: [],
    diagnostics: new HirDiagnosticSink(),
  });

  expect(lookup.referenceForSpan({ moduleId: moduleId(1), span, kind: "functionName" })).toEqual({
    kind: "function",
    itemId: itemId(1),
    functionId: functionId(1),
  });
});

test("span lookup without kind returns the first deterministic same-span reference", () => {
  const references = new ResolvedReferencesBuilder();
  const span = SourceSpan.from(1, 5);
  references.add(
    { moduleId: moduleId(0), span, kind: "typeName", ordinal: 0 },
    { kind: "type", itemId: itemId(1), typeId: typeId(1) },
  );
  references.add(
    { moduleId: moduleId(0), span, kind: "functionName", ordinal: 0 },
    { kind: "function", itemId: itemId(2), functionId: functionId(2) },
  );

  const lookup = buildHirReferenceLookup({
    references: references.build(),
    completedMembers: {
      get: () => undefined,
      entries: () => [],
    },
    requirementReferences: [],
    diagnostics: new HirDiagnosticSink(),
  });

  expect(lookup.referenceForSpan({ moduleId: moduleId(0), span })).toEqual({
    kind: "function",
    itemId: itemId(2),
    functionId: functionId(2),
  });
});
