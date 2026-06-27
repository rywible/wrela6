import { describe, expect, test } from "bun:test";
import { hirPlatformContractEdgeId } from "../../../src/hir/ids";
import type {
  LayoutFactProgram,
  LayoutFunctionAbiFact,
  LayoutPlatformAbiFact,
} from "../../../src/layout/layout-program";
import {
  emptyFunctionAbiTable,
  emptyImageDeviceTable,
  emptyPlatformAbiTable,
  emptyValidatedBufferTable,
} from "../../../src/layout/layout-fact-builder-support";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoCallExpression,
  MonoCheckedType,
  MonoDeterministicTable,
  MonoExpressionId,
  MonoFunctionBodyStatus,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoLocalId,
  MonoPlatformContractEdge,
  MonomorphizedHirProgram,
} from "../../../src/mono/mono-hir";
import { buildMonomorphicPlatformEdgeKey } from "../../../src/mono/platform-contract-edge";
import {
  emptyMonoResolvedCallTargetTable,
  monoResolvedCallTargetTableFromEntries,
} from "../../../src/mono/resolved-call-targets";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  createProofMirCallTargetIndex,
  type CreateProofMirCallTargetIndexInput,
} from "../../../src/proof-mir/domains/call-targets";
import { proofMirRuntimeCallId, proofMirRuntimeOperationId } from "../../../src/proof-mir/ids";
import {
  proofMirRuntimeCatalogFake,
  proofMirRuntimeOperationFake,
} from "../../support/proof-mir/proof-mir-fakes";
import {
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
} from "../../support/layout/layout-fixtures";
import {
  coreTypeId,
  functionId,
  itemId,
  platformContractId,
  platformPrimitiveId,
  targetId,
} from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import type { HirPlatformContractEdgeId } from "../../../src/hir/ids";

const FIXTURE_SOURCE_ORIGIN = "proof-mir-call-target:0:0";
const CALLER_INSTANCE_ID = monoInstanceId("fn:caller");
const CALLEE_INSTANCE_ID = monoInstanceId("fn:callee");
const RECOVERY_INSTANCE_ID = monoInstanceId("fn:recovery");
const PLATFORM_INSTANCE_ID = monoInstanceId("fn:platform-exit");
const CALL_EXPRESSION_ID = instantiatedHirId(CALLER_INSTANCE_ID, 2 as never) as MonoExpressionId;

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
    locals: monoTable<MonoLocalId, MonoLocal>([], (local) => local.localId),
    declaredRequirements: [],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function minimalFunctionAbiFact(
  functionInstanceId: ReturnType<typeof monoInstanceId>,
): LayoutFunctionAbiFact {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
  return {
    functionInstanceId,
    sourceFunctionId: functionId(1),
    hiddenParameters: [],
    parameters: [],
    returnValue: {
      type: neverLayout.key,
      layout: neverLayout,
      shape: { kind: "none", reason: "never", proofCarrying: false },
      sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function minimalPlatformAbiFact(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  primitiveId: ReturnType<typeof platformPrimitiveId>,
): LayoutPlatformAbiFact {
  return {
    edgeId,
    primitiveId,
    contractId: platformContractId("exit"),
    targetId: targetId("x64-test"),
    hiddenParameters: [],
    arguments: [],
    result: { kind: "none", reason: "never", proofCarrying: false },
    callConvention: "wrela-source" as LayoutPlatformAbiFact["callConvention"],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function emptyEnumTable(): LayoutFactProgram["enums"] {
  return layoutDeterministicTable({
    entries: [],
    keyOf: () => ({}) as never,
    keyString: () => "enum:test" as LayoutCanonicalKeyString,
  } as never);
}

function emptyTypeTable(): LayoutFactProgram["types"] {
  return layoutDeterministicTable({
    entries: [],
    keyOf: () => ({}) as never,
    keyString: () => "core:test" as LayoutCanonicalKeyString,
  } as never);
}

function emptyFieldTable(): LayoutFactProgram["fields"] {
  return layoutDeterministicTable({
    entries: [],
    keyOf: () => ({}) as never,
    keyString: () => "field:test" as LayoutCanonicalKeyString,
  } as never);
}

function layoutFactProgramForTest(input: {
  readonly functions?: readonly LayoutFunctionAbiFact[];
  readonly platformEdges?: readonly LayoutPlatformAbiFact[];
}): LayoutFactProgram {
  const target = layoutTargetSurfaceFake();
  return {
    target: normalizeTargetFactsForTest(target),
    types: emptyTypeTable(),
    fields: emptyFieldTable(),
    enums: emptyEnumTable(),
    validatedBuffers: emptyValidatedBufferTable(),
    imageDevices: emptyImageDeviceTable(),
    functions:
      input.functions === undefined
        ? emptyFunctionAbiTable()
        : layoutDeterministicTable({
            entries: input.functions,
            keyOf: (entry) => entry.functionInstanceId,
            keyString: (key) => `function:${String(key)}` as LayoutCanonicalKeyString,
          }),
    platformEdges:
      input.platformEdges === undefined
        ? emptyPlatformAbiTable()
        : layoutDeterministicTable({
            entries: input.platformEdges,
            keyOf: (entry) => entry.edgeId,
            keyString: () => "platform-edge:test" as LayoutCanonicalKeyString,
          }),
    imageEntry: {} as LayoutFactProgram["imageEntry"],
  };
}

function minimalMonoProgram(input: {
  readonly functions: readonly MonoFunctionInstance[];
  readonly platformEdges?: readonly MonoPlatformContractEdge[];
  readonly resolvedCallTargets?: ReturnType<typeof monoResolvedCallTargetTableFromEntries>;
}): MonomorphizedHirProgram {
  return {
    functions: monoTable(input.functions, (entry) => entry.instanceId),
    proofMetadata: {
      platformContractEdges: monoTable(input.platformEdges ?? [], (entry) => entry.edgeId),
    },
    resolvedCallTargets: input.resolvedCallTargets ?? emptyMonoResolvedCallTargetTable(),
  } as MonomorphizedHirProgram;
}

function minimalCallExpression(input: {
  readonly resolvedTarget?: MonoCallExpression["resolvedTarget"];
  readonly recovered?: boolean;
}): MonoCallExpression {
  return {
    callee: {
      expressionId: instantiatedHirId(CALLER_INSTANCE_ID, 1 as never),
      kind: { kind: "name", name: "callee" },
      type: neverMonoType(),
      resourceKind: "Copy",
      sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    },
    ownerTypeArguments: [],
    ownerTypeArgumentSource: "none",
    arguments: [],
    typeArguments: [],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    ...(input.resolvedTarget === undefined ? {} : { resolvedTarget: input.resolvedTarget }),
    ...(input.recovered === undefined ? {} : { recovered: input.recovered }),
  };
}

function platformEdgeForTest(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  primitiveId: ReturnType<typeof platformPrimitiveId>,
): MonoPlatformContractEdge {
  return {
    edgeId,
    sourceFunctionId: functionId(0),
    primitiveId,
    contractId: platformContractId("exit"),
    targetId: targetId("x64-test"),
    callExpressionId: CALL_EXPRESSION_ID,
    instantiatedOwnerTypeArguments: [],
    instantiatedFunctionTypeArguments: [],
    monomorphicEdgeKey: buildMonomorphicPlatformEdgeKey({
      callerInstanceId: CALLER_INSTANCE_ID,
      callExpressionId: CALL_EXPRESSION_ID,
      calleeFunctionId: functionId(0),
      ownerTypeArguments: [],
      functionTypeArguments: [],
    }),
    abi: {
      targetId: targetId("x64-test"),
      primitiveId,
      contractId: platformContractId("exit"),
    },
    ensuredFacts: [],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

export interface ProofMirCallTargetFixtureOptions {
  readonly targetBodyStatus?: MonoFunctionBodyStatus;
  readonly includeFunctionAbi?: boolean;
  readonly includePlatformAbi?: boolean;
  readonly resolvedTarget?: MonoCallExpression["resolvedTarget"];
  readonly recovered?: boolean;
  readonly missingResolvedTarget?: boolean;
  readonly missingCallee?: boolean;
  readonly missingPlatformEdge?: boolean;
  readonly primitiveMismatch?: boolean;
  readonly target?: CreateProofMirCallTargetIndexInput["target"];
}

export interface ProofMirCallTargetFixture extends CreateProofMirCallTargetIndexInput {
  readonly callExpression: MonoCallExpression;
  readonly callExpressionId: MonoExpressionId;
  readonly callerFunctionInstanceId: ReturnType<typeof monoInstanceId>;
}

export function proofMirCallTargetFixture(
  options: ProofMirCallTargetFixtureOptions = {},
): ProofMirCallTargetFixture {
  const targetBodyStatus = options.targetBodyStatus ?? "sourceBody";
  const calleeInstanceId =
    targetBodyStatus === "bodylessRecovery"
      ? RECOVERY_INSTANCE_ID
      : targetBodyStatus === "certifiedPlatform"
        ? PLATFORM_INSTANCE_ID
        : CALLEE_INSTANCE_ID;

  const edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId> = {
    owner: { kind: "function", instanceId: CALLER_INSTANCE_ID },
    instanceId: CALLER_INSTANCE_ID,
    hirId: hirPlatformContractEdgeId(1),
  };
  const primitive = platformPrimitiveId("exit");
  const wrongPrimitive = platformPrimitiveId("other");

  const functions = [
    minimalFunctionInstance({ instanceId: CALLER_INSTANCE_ID, bodyStatus: "sourceBody" }),
    minimalFunctionInstance({ instanceId: calleeInstanceId, bodyStatus: targetBodyStatus }),
  ];

  const platformEdges =
    options.missingPlatformEdge === true ? [] : [platformEdgeForTest(edgeId, primitive)];

  const resolvedTarget =
    options.missingResolvedTarget === true
      ? undefined
      : (options.resolvedTarget ??
        (targetBodyStatus === "certifiedPlatform"
          ? {
              kind: "certifiedPlatform" as const,
              targetPlatformEdgeId: edgeId,
              primitiveId: options.primitiveMismatch === true ? wrongPrimitive : primitive,
            }
          : {
              kind: "sourceFunction" as const,
              targetFunctionInstanceId:
                options.missingCallee === true ? monoInstanceId("fn:missing") : calleeInstanceId,
            }));

  const program = minimalMonoProgram({
    functions,
    platformEdges,
    ...(resolvedTarget === undefined
      ? {}
      : {
          resolvedCallTargets: monoResolvedCallTargetTableFromEntries([
            {
              callerInstanceId: CALLER_INSTANCE_ID,
              callExpressionId: CALL_EXPRESSION_ID,
              resolvedTarget,
            },
          ]),
        }),
  });

  const layout = layoutFactProgramForTest({
    ...(options.includeFunctionAbi !== false && targetBodyStatus === "sourceBody"
      ? { functions: [minimalFunctionAbiFact(CALLEE_INSTANCE_ID)] }
      : options.includeFunctionAbi === true
        ? { functions: [minimalFunctionAbiFact(calleeInstanceId)] }
        : {}),
    ...(options.includePlatformAbi === true
      ? { platformEdges: [minimalPlatformAbiFact(edgeId, primitive)] }
      : {}),
  });

  const runtimeCatalog =
    options.target?.runtimeCatalog ??
    proofMirRuntimeCatalogFake({
      operations: [
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "panic_abort",
        }),
      ],
    });

  return {
    program,
    layout,
    target: options.target ?? {
      targetId: targetId("x64-test"),
      features: [],
      runtimeCatalog,
    },
    callerFunctionInstanceId: CALLER_INSTANCE_ID,
    callExpression: minimalCallExpression({
      ...(resolvedTarget === undefined ? {} : { resolvedTarget }),
      ...(options.recovered === true ? { recovered: true } : {}),
    }),
    callExpressionId: CALL_EXPRESSION_ID,
  };
}

describe("ProofMirCallTargetIndex", () => {
  test("bodyless recovery call target is rejected before lowering", () => {
    const fixture = proofMirCallTargetFixture({ targetBodyStatus: "bodylessRecovery" });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_CALL_TARGET_KIND_MISMATCH"),
    );
  });

  test("source calls resolve to sourceFunction targets with matching function ABI facts", () => {
    const fixture = proofMirCallTargetFixture({ targetBodyStatus: "sourceBody" });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.target).toEqual({
      kind: "sourceFunction",
      functionInstanceId: CALLEE_INSTANCE_ID,
      abi: { kind: "functionAbi", functionInstanceId: CALLEE_INSTANCE_ID },
    });
  });

  test("certified platform calls resolve with contract edge and platform ABI facts", () => {
    const fixture = proofMirCallTargetFixture({
      targetBodyStatus: "certifiedPlatform",
      includePlatformAbi: true,
    });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.target.kind).toBe("certifiedPlatform");
    if (result.target.kind !== "certifiedPlatform") return;
    expect(result.target.abi).toEqual({
      kind: "platformAbi",
      edgeId: result.target.edgeId,
    });
  });

  test("missing concrete resolved targets return PROOF_MIR_MISSING_CONCRETE_CALL_TARGET", () => {
    const fixture = proofMirCallTargetFixture({ missingResolvedTarget: true });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_CONCRETE_CALL_TARGET"),
    );
  });

  test("recovered calls return PROOF_MIR_INVALID_CONCRETE_CALL_TARGET", () => {
    const fixture = proofMirCallTargetFixture({ recovered: true });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CONCRETE_CALL_TARGET"),
    );
  });

  test("unresolved source function instances return PROOF_MIR_UNRESOLVED_CALL_TARGET", () => {
    const fixture = proofMirCallTargetFixture({ missingCallee: true });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_UNRESOLVED_CALL_TARGET"),
    );
  });

  test("missing function ABI facts return PROOF_MIR_MISSING_FUNCTION_ABI_FACT", () => {
    const fixture = proofMirCallTargetFixture({
      targetBodyStatus: "sourceBody",
      includeFunctionAbi: false,
    });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_ABI_FACT"),
    );
  });

  test("missing platform contract edges return PROOF_MIR_UNRESOLVED_CALL_TARGET", () => {
    const fixture = proofMirCallTargetFixture({
      targetBodyStatus: "certifiedPlatform",
      resolvedTarget: {
        kind: "certifiedPlatform",
        targetPlatformEdgeId: {
          owner: { kind: "function", instanceId: CALLER_INSTANCE_ID },
          instanceId: CALLER_INSTANCE_ID,
          hirId: hirPlatformContractEdgeId(99),
        },
        primitiveId: platformPrimitiveId("exit"),
      },
      missingPlatformEdge: true,
    });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_UNRESOLVED_CALL_TARGET"),
    );
  });

  test("missing platform ABI facts return PROOF_MIR_MISSING_PLATFORM_ABI_FACT", () => {
    const edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId> = {
      owner: { kind: "function", instanceId: CALLER_INSTANCE_ID },
      instanceId: CALLER_INSTANCE_ID,
      hirId: hirPlatformContractEdgeId(3),
    };
    const primitive = platformPrimitiveId("exit");
    const fixture = proofMirCallTargetFixture({
      targetBodyStatus: "certifiedPlatform",
      includePlatformAbi: false,
      resolvedTarget: {
        kind: "certifiedPlatform",
        targetPlatformEdgeId: edgeId,
        primitiveId: primitive,
      },
      missingPlatformEdge: false,
    });
    const index = createProofMirCallTargetIndex({
      ...fixture,
      program: minimalMonoProgram({
        functions: fixture.program.functions.entries(),
        platformEdges: [platformEdgeForTest(edgeId, primitive)],
        resolvedCallTargets: monoResolvedCallTargetTableFromEntries([
          {
            callerInstanceId: CALLER_INSTANCE_ID,
            callExpressionId: CALL_EXPRESSION_ID,
            resolvedTarget: {
              kind: "certifiedPlatform",
              targetPlatformEdgeId: edgeId,
              primitiveId: primitive,
            },
          },
        ]),
      }),
    });

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_PLATFORM_ABI_FACT"),
    );
  });

  test("platform primitive mismatches return PROOF_MIR_CALL_TARGET_KIND_MISMATCH", () => {
    const fixture = proofMirCallTargetFixture({
      targetBodyStatus: "certifiedPlatform",
      includePlatformAbi: true,
      primitiveMismatch: true,
    });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveMonoCall({
      call: fixture.callExpression,
      monoExpressionId: fixture.callExpressionId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_CALL_TARGET_KIND_MISMATCH"),
    );
  });

  test("compiler runtime targets check catalog availability before instantiation", () => {
    const fixture = proofMirCallTargetFixture();
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveCompilerRuntime({
      runtimeId: proofMirRuntimeOperationId(1),
      runtimeCallId: proofMirRuntimeCallId(1),
      callerFunctionInstanceId: fixture.callerFunctionInstanceId,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.target).toEqual({
      kind: "compilerRuntime",
      runtimeId: proofMirRuntimeOperationId(1),
      runtimeCallId: proofMirRuntimeCallId(1),
    });
  });

  test("missing runtime catalog entries return PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY", () => {
    const fixture = proofMirCallTargetFixture();
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveCompilerRuntime({
      runtimeId: proofMirRuntimeOperationId(99),
      runtimeCallId: proofMirRuntimeCallId(99),
      callerFunctionInstanceId: fixture.callerFunctionInstanceId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY"),
    );
  });

  test("runtime operations unavailable on the selected target return PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE", () => {
    const fixture = proofMirCallTargetFixture({
      target: {
        targetId: targetId("other-target"),
        features: [],
        runtimeCatalog: proofMirRuntimeCatalogFake({
          operations: [
            proofMirRuntimeOperationFake({
              runtimeId: proofMirRuntimeOperationId(5),
              name: "target_only",
              targetAvailability: { kind: "target", targetId: targetId("x64-test") },
            }),
          ],
        }),
      },
    });
    const index = createProofMirCallTargetIndex(fixture);

    const result = index.resolveCompilerRuntime({
      runtimeId: proofMirRuntimeOperationId(5),
      runtimeCallId: proofMirRuntimeCallId(5),
      callerFunctionInstanceId: fixture.callerFunctionInstanceId,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE"),
    );
  });
});
