import { describe, expect, test } from "bun:test";
import { functionId, typeId } from "../../../src/semantic/ids";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { instantiateMonoType } from "../../../src/mono/type-instantiator";
import {
  emptyMonoAncestryForTest,
  genericBoxProgramForMonoTest,
  minimalClosedProgramForMonoTest,
  monoCoreType,
  monoTypeKeyForTest,
  mutualFunctionRecursionProgramForMonoTest,
  twoCallSitesSameGenericInstanceProgramForMonoTest,
  unresolvedGenericAtBoundaryProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

describe("closed boundary rejection", () => {
  test("rejects mutually recursive function cycle with a diagnostic", () => {
    const result = monomorphizeWholeImage({ program: mutualFunctionRecursionProgramForMonoTest() });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain(monoDiagnosticCode("MONO_RECURSIVE_FUNCTION_CYCLE"));
    }
  });

  test("non-recursive programs do not emit recursion diagnostics", () => {
    const result = monomorphizeWholeImage({
      program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).not.toContain("MONO_RECURSIVE_FUNCTION_CYCLE");
      expect(codes).not.toContain("MONO_RECURSIVE_TYPE_CYCLE");
      expect(codes).not.toContain("MONO_POLYMORPHIC_RECURSION");
    }
  });

  test("non-recursive type instantiation succeeds without emitting type cycle diagnostics", () => {
    const result = instantiateMonoType({
      program: genericBoxProgramForMonoTest(),
      key: monoTypeKeyForTest({ typeId: typeId(1), typeArguments: [monoCoreType("u32")] }),
      source: { kind: "image", imageId: 0 as never },
      ancestry: emptyMonoAncestryForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.instance.sourceTypeId).toBe(typeId(1));
    }
  });

  test("generic function instance is reachable from the entry function and has one canonical key", () => {
    const result = monomorphizeWholeImage({
      program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const identityInstances = result.program.functions
        .entries()
        .filter((entry) => entry.sourceFunctionId === functionId(9));
      expect(identityInstances).toHaveLength(1);
    }
  });

  test("unresolved generic type parameter at boundary is rejected once per root cause", () => {
    const result = monomorphizeWholeImage({
      program: unresolvedGenericAtBoundaryProgramForMonoTest(),
    });

    expect(result.kind).toBe("error");
    const unresolved =
      result.kind === "error"
        ? result.diagnostics.filter(
            (diagnostic) => diagnostic.code === "MONO_UNRESOLVED_TYPE_PARAMETER",
          )
        : [];

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.relatedInformation?.length).toBeGreaterThan(0);
  });

  test("successful result contains no error diagnostics", () => {
    const result = monomorphizeWholeImage({
      program: minimalClosedProgramForMonoTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);
    }
  });
});
