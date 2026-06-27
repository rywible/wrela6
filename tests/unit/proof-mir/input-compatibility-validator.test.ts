import { describe, expect, test } from "bun:test";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import { monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoDeterministicTable,
  MonoFunctionBodyStatus,
  MonoFunctionInstance,
  MonoLocal,
} from "../../../src/mono/mono-hir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { validateProofMirBuildInputCompatibility } from "../../../src/proof-mir/validation/input-compatibility-validator";
import { proofMirRuntimeCatalogFake } from "../../support/proof-mir/proof-mir-fakes";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import { coreTypeId, functionId, itemId, targetId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import type { MonoCheckedType } from "../../../src/mono/mono-hir";

function monoTable<Key, Value>(
  entries: readonly Value[],
  keyOf: (value: Value) => Key,
): MonoDeterministicTable<Key, Value> {
  const lookup = new Map<string, Value>();
  for (const entry of entries) {
    lookup.set(String(keyOf(entry)), entry);
  }
  return {
    get(key) {
      return lookup.get(String(key));
    },
    entries: () => entries,
  };
}

function neverMonoType(): MonoCheckedType {
  return coreCheckedType(coreTypeId("Never")) as MonoCheckedType;
}

function minimalFunctionInstance(input: {
  readonly instanceId: ReturnType<typeof monoInstanceId>;
  readonly bodyStatus: MonoFunctionBodyStatus;
}): MonoFunctionInstance {
  const sourceSpan = { start: 0, end: 0, length: 0 };
  return {
    instanceId: input.instanceId,
    sourceFunctionId: functionId(1),
    sourceItemId: itemId(1),
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: functionId(1),
      itemId: itemId(1),
      parameters: [],
      returnType: neverMonoType(),
      returnKind: "Never",
      modifiers: {
        isPlatform: input.bodyStatus === "certifiedPlatform",
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan,
    },
    bodyStatus: input.bodyStatus,
    locals: monoTable([] as MonoLocal[], (local) => local.localId),
    declaredRequirements: [],
    sourceOrigin: "input-compatibility-validator.test",
  };
}

function withProgramFunctions(
  input: ReturnType<typeof closedProofMirFixture>,
  functions: readonly MonoFunctionInstance[],
): ReturnType<typeof closedProofMirFixture> {
  return {
    ...input,
    program: {
      ...input.program,
      functions: monoTable(functions, (functionInstance) => functionInstance.instanceId),
    },
  };
}

function withoutLayoutFunctionAbi(
  layout: LayoutFactProgram,
  functionInstanceId: ReturnType<typeof monoInstanceId>,
): LayoutFactProgram {
  const remaining = layout.functions
    .entries()
    .filter((fact) => fact.functionInstanceId !== functionInstanceId);
  return {
    ...layout,
    functions: layoutDeterministicTable({
      entries: remaining,
      keyOf: (fact) => fact.functionInstanceId,
      keyString: layout.functions.keyString,
    }),
  };
}

describe("validateProofMirBuildInputCompatibility", () => {
  test("closed fixture passes input compatibility validation", () => {
    const diagnostics = validateProofMirBuildInputCompatibility(closedProofMirFixture());

    expect(diagnostics).toEqual([]);
  });

  test("stale layout target is rejected before function lowering", () => {
    const input = closedProofMirFixture();
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      target: {
        ...input.target,
        targetId: targetId("different-target"),
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"),
    );
  });

  test("runtime catalog target mismatch is rejected", () => {
    const input = closedProofMirFixture();
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      target: {
        ...input.target,
        runtimeCatalog: proofMirRuntimeCatalogFake({
          targetId: targetId("catalog-target-mismatch"),
          features: input.target.features,
          operations: input.target.runtimeCatalog.entries(),
        }),
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY"),
    );
  });

  test("runtime catalog features mismatch is rejected", () => {
    const input = closedProofMirFixture();
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      target: {
        ...input.target,
        features: [...input.target.features, "extra-feature"],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY"),
    );
  });

  test("missing executable image entry is rejected", () => {
    const input = closedProofMirFixture();
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      program: {
        ...input.program,
        image: {
          ...input.program.image,
          entryFunctionInstanceId: undefined,
        },
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_IMAGE_ENTRY"),
    );
  });

  test("missing image entry external root is rejected", () => {
    const input = closedProofMirFixture();
    const entryFunctionInstanceId = input.program.image.entryFunctionInstanceId;
    if (entryFunctionInstanceId === undefined) {
      throw new Error("expected entry function instance in closed fixture");
    }

    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      program: {
        ...input.program,
        externalRoots: input.program.externalRoots.map((root) =>
          root.reason === "imageEntry" ? { ...root, reason: "deviceHandler" } : root,
        ),
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_IMAGE_ENTRY"),
    );
  });

  test("image entry external root must match monomorphized entry function instance", () => {
    const input = closedProofMirFixture();
    const imageEntryRoot = input.program.externalRoots.find((root) => root.reason === "imageEntry");
    if (imageEntryRoot === undefined) {
      throw new Error("expected image entry external root in closed fixture");
    }

    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      program: {
        ...input.program,
        externalRoots: [
          {
            ...imageEntryRoot,
            functionInstanceId: monoInstanceId("fn:wrong-entry"),
          },
        ],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_EXTERNAL_ROOT"),
    );
  });

  test("missing external roots are rejected", () => {
    const input = closedProofMirFixture();
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      program: {
        ...input.program,
        externalRoots: [],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_EXTERNAL_ROOTS"),
    );
  });

  test("invalid external roots are rejected", () => {
    const input = closedProofMirFixture();
    const imageEntryRoot = input.program.externalRoots.find((root) => root.reason === "imageEntry");
    if (imageEntryRoot === undefined) {
      throw new Error("expected image entry external root in closed fixture");
    }

    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      program: {
        ...input.program,
        externalRoots: [
          {
            ...imageEntryRoot,
            functionInstanceId: monoInstanceId("missing:function"),
          },
        ],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_EXTERNAL_ROOT"),
    );
  });

  test("missing function ABI facts are rejected", () => {
    const input = closedProofMirFixture();
    const functionInstance = input.program.functions.entries()[0];
    if (functionInstance === undefined) {
      throw new Error("expected function instance in closed fixture");
    }

    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      layout: withoutLayoutFunctionAbi(input.layout, functionInstance.instanceId),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_ABI_FACT"),
    );
  });

  test("reachable bodylessRecovery functions are rejected", () => {
    const input = closedProofMirFixture();
    const recoveryInstance = minimalFunctionInstance({
      instanceId: monoInstanceId("fn:recovery"),
      bodyStatus: "bodylessRecovery",
    });
    const diagnostics = validateProofMirBuildInputCompatibility(
      withProgramFunctions(input, [...input.program.functions.entries(), recoveryInstance]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
    );
  });

  test("extra layout type facts are rejected", () => {
    const input = closedProofMirFixture();
    const extraTypeKey = {
      kind: "source" as const,
      instanceId: monoInstanceId("type:extra-layout-only"),
    };
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      layout: {
        ...input.layout,
        types: layoutDeterministicTable({
          entries: [
            ...input.layout.types.entries(),
            {
              key: extraTypeKey,
              sizeBytes: 1n,
              alignmentBytes: 1n,
              strideBytes: 1n,
              representation: { kind: "primitive", primitive: "unsignedInteger" },
              sourceOrigin: "input-compatibility-validator.test",
            },
          ],
          keyOf: (entry) => entry.key,
          keyString: input.layout.types.keyString,
        }),
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_LAYOUT_KEY_SET_MISMATCH"),
    );
  });

  test("reports independent diagnostics in deterministic order", () => {
    const input = closedProofMirFixture();
    const diagnostics = validateProofMirBuildInputCompatibility({
      ...input,
      target: {
        ...input.target,
        targetId: targetId("different-target"),
      },
      program: {
        ...input.program,
        externalRoots: [],
      },
    });

    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain(proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"));
    expect(codes).toContain(proofMirDiagnosticCode("PROOF_MIR_MISSING_EXTERNAL_ROOTS"));
    expect(codes.indexOf(proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"))).toBeLessThan(
      codes.indexOf(proofMirDiagnosticCode("PROOF_MIR_MISSING_EXTERNAL_ROOTS")),
    );
    expect(diagnostics).toEqual(
      [...diagnostics].sort((left, right) => {
        const leftOrder = left.order;
        const rightOrder = right.order;
        return (
          leftOrder.sourceOrigin.localeCompare(rightOrder.sourceOrigin) ||
          leftOrder.functionInstanceId.localeCompare(rightOrder.functionInstanceId) ||
          leftOrder.nodeDetail.localeCompare(rightOrder.nodeDetail) ||
          leftOrder.code.localeCompare(rightOrder.code) ||
          leftOrder.ownerKey.localeCompare(rightOrder.ownerKey) ||
          leftOrder.rootCauseKey.localeCompare(rightOrder.rootCauseKey) ||
          leftOrder.stableDetail.localeCompare(rightOrder.stableDetail)
        );
      }),
    );
  });
});
