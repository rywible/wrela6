import { describe, expect, test } from "bun:test";
import type { MonoDiagnostic } from "../../../src/mono/diagnostics";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { buildMonoExternalRoots, monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { canonicalFunctionInstanceId } from "../../../src/mono/instantiation-key";
import type { MonoFunctionInstance } from "../../../src/mono/mono-hir";
import { errorCheckedType } from "../../../src/semantic/surface/type-model";
import {
  minimalClosedProgramForMonoTest,
  ownerMethodInstantiationProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

describe("buildMonoExternalRoots", () => {
  test("preserves normalization diagnostics when external root arguments fail", () => {
    const base = ownerMethodInstantiationProgramForMonoTest();
    const program = {
      ...base,
      monoClosure: {
        ...base.monoClosure,
        externalEntryRoots: base.monoClosure.externalEntryRoots.map((root) =>
          root.reason === "targetRequired"
            ? { ...root, ownerTypeArguments: [errorCheckedType()] }
            : root,
        ),
      },
    };
    const diagnostics: MonoDiagnostic[] = [];
    const lookup = new Map<string, MonoFunctionInstance>();

    const roots = buildMonoExternalRoots({
      program,
      functionTableLookup: lookup,
      diagnostics,
    });

    expect(roots).toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_RESOURCE_KIND"),
    );
  });

  test("reports dropped external roots that do not resolve to reachable instances", () => {
    const program = minimalClosedProgramForMonoTest();
    const image = program.images.entries()[0];
    const entryFunctionId = image?.entryFunctionId;
    if (entryFunctionId === undefined) {
      throw new Error("expected image entry function");
    }
    const entryFunction = program.functions.get(entryFunctionId);
    if (entryFunction === undefined) {
      throw new Error("expected entry function");
    }
    const imageEntryRoot = program.monoClosure.externalEntryRoots.find(
      (root) => root.reason === "imageEntry",
    );
    if (imageEntryRoot === undefined) {
      throw new Error("expected image entry external root");
    }
    const diagnostics: MonoDiagnostic[] = [];
    const lookup = new Map<string, MonoFunctionInstance>();

    const roots = buildMonoExternalRoots({
      program,
      functionTableLookup: lookup,
      diagnostics,
    });

    expect(roots).toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_DROPPED_EXTERNAL_ROOT"),
    );
  });

  test("monomorphization preserves external root resolution diagnostics", () => {
    const base = ownerMethodInstantiationProgramForMonoTest();
    const program = {
      ...base,
      monoClosure: {
        ...base.monoClosure,
        externalEntryRoots: base.monoClosure.externalEntryRoots.map((root) =>
          root.reason === "targetRequired"
            ? { ...root, ownerTypeArguments: [errorCheckedType()] }
            : root,
        ),
      },
    };

    const result = monomorphizeWholeImage({ program });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_RESOURCE_KIND"),
    );
  });

  test("resolves reachable external roots through the function table lookup", () => {
    const monoResult = monomorphizeWholeImage({ program: minimalClosedProgramForMonoTest() });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const program = minimalClosedProgramForMonoTest();
    const imageEntryRoot = program.monoClosure.externalEntryRoots.find(
      (root) => root.reason === "imageEntry",
    );
    if (imageEntryRoot === undefined) {
      throw new Error("expected image entry external root");
    }
    const entryFunction = program.functions.get(imageEntryRoot.functionId);
    if (entryFunction === undefined) {
      throw new Error("expected entry function");
    }
    const lookupKey = String(
      canonicalFunctionInstanceId({
        functionId: imageEntryRoot.functionId,
        ...(entryFunction.ownerTypeId !== undefined
          ? { ownerTypeId: entryFunction.ownerTypeId }
          : {}),
        ownerTypeArguments: [],
        functionTypeArguments: [],
      }),
    );
    const reachableInstance = monoResult.program.functions.entries().find((functionInstance) => {
      return functionInstance.sourceFunctionId === imageEntryRoot.functionId;
    });
    if (reachableInstance === undefined) {
      throw new Error("expected reachable entry function instance");
    }
    const lookup = new Map<string, MonoFunctionInstance>([[lookupKey, reachableInstance]]);
    const diagnostics: MonoDiagnostic[] = [];

    const roots = buildMonoExternalRoots({
      program,
      functionTableLookup: lookup,
      diagnostics,
    });

    expect(diagnostics).toEqual([]);
    expect(roots.some((root) => root.reason === "imageEntry")).toBe(true);
    expect(roots.find((root) => root.reason === "imageEntry")?.functionInstanceId).toBe(
      reachableInstance.instanceId,
    );
  });
});
