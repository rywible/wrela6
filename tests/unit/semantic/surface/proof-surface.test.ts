import { expect, test } from "bun:test";
import { functionId } from "../../../../src/semantic/ids";
import { SourceText } from "../../../../src/frontend";
import {
  checkedProofSurface,
  checkedProofSurfaceEmpty,
  requirementSurface,
  terminalSurface,
} from "../../../../src/semantic/surface/proof-surface";

function sourceForTest(): ReturnType<typeof SourceText.from> {
  return SourceText.from("test.wr", "fn test(): requires x.valid\n");
}

test("proof surface preserves requirement spans", () => {
  const span = sourceForTest().span(10, 18);
  const surface = checkedProofSurface({
    requirements: [
      requirementSurface({
        ownerFunctionId: functionId(0),
        expression: { kind: "opaque", text: "x.valid" },
        span,
      }),
    ],
  });

  expect(surface.requirementSurfaces.entries()[0]!.span).toEqual(span);
});

test("terminal surface stores terminal declaration seed", () => {
  const span = sourceForTest().span(0, 8);
  const surface = checkedProofSurface({
    terminalSurfaces: [terminalSurface({ functionId: functionId(0), span })],
  });

  expect(surface.terminalSurfaces.get(functionId(0))!.span).toEqual(span);
});

test("empty proof surface has empty seed tables", () => {
  const surface = checkedProofSurface({});
  expect(surface.resourceKindByType.entries()).toEqual([]);
  expect(surface.signatureModes.entries()).toEqual([]);
  expect(surface.requirementSurfaces.entries()).toEqual([]);
  expect(surface.predicateFactSurfaces.entries()).toEqual([]);
  expect(surface.terminalSurfaces.entries()).toEqual([]);
  expect(surface.validationSurfaces.entries()).toEqual([]);
  expect(surface.privateStateSurfaces.entries()).toEqual([]);
  expect(surface.imageSurfaces.entries()).toEqual([]);
  expect(surface.platformContracts.entries()).toEqual([]);
});

test("builder-empty proof surface has empty platform contract table", () => {
  const surface = checkedProofSurfaceEmpty();

  expect(surface.platformContracts.entries()).toEqual([]);
});

test("requirementSurface factory creates surface with correct fields", () => {
  const span = sourceForTest().span(0, 5);
  const surface = requirementSurface({
    ownerFunctionId: functionId(0),
    expression: { kind: "opaque", text: "x > 0" },
    span,
  });

  expect(surface.ownerFunctionId).toBe(functionId(0));
  expect(surface.expression.kind).toBe("opaque");
  expect(surface.expression.text).toBe("x > 0");
});
