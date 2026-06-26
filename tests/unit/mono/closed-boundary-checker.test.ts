import { expect, test } from "bun:test";
import { checkClosedMonoBoundary } from "../../../src/mono/closed-boundary-checker";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { genericParameterCheckedType } from "../../../src/semantic/surface/type-model";
import { itemId } from "../../../src/semantic/ids";
import { minimalClosedProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";

test("closed boundary checker accepts a minimal closed image", () => {
  const sourceProgram = minimalClosedProgramForMonoTest();
  const result = monomorphizeWholeImage({ program: sourceProgram });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const boundary = checkClosedMonoBoundary({
    sourceProgram,
    program: result.program,
  });

  expect(boundary.diagnostics).toEqual([]);
});

test("closed boundary checker suppresses duplicate unresolved type diagnostics", () => {
  const sourceProgram = minimalClosedProgramForMonoTest();
  const result = monomorphizeWholeImage({ program: sourceProgram });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const [entry] = result.program.functions.entries();
  expect(entry).toBeDefined();
  if (entry === undefined) return;
  const unresolved = genericParameterCheckedType({
    owner: { kind: "item", itemId: itemId(999) },
    index: 0,
  });
  const unresolvedMono = unresolved as never;
  const mutatedFunction = {
    ...entry,
    functionTypeArguments: [unresolvedMono],
    signature: {
      ...entry.signature,
      returnType: unresolvedMono,
      parameters: entry.signature.parameters.map((parameter) => ({
        ...parameter,
        type: unresolvedMono,
      })),
    },
  };
  const mutatedProgram = {
    ...result.program,
    functions: {
      ...result.program.functions,
      entries: () => [mutatedFunction],
      get: () => mutatedFunction,
    },
  };

  const boundary = checkClosedMonoBoundary({
    sourceProgram,
    program: mutatedProgram,
  });
  const unresolvedDiagnostics = boundary.diagnostics.filter(
    (diagnostic) => diagnostic.code === "MONO_UNRESOLVED_TYPE_PARAMETER",
  );

  expect(unresolvedDiagnostics).toHaveLength(1);
  expect(unresolvedDiagnostics[0]?.relatedInformation?.length).toBeGreaterThan(0);
});
