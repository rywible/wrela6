import type { FunctionId } from "../semantic/ids";
import type {
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoPlatformContractEdge,
  MonomorphizedHirProgram,
} from "../mono/mono-hir";
import type { MonoCheckedType } from "../mono/mono-hir";
import type { HirPlatformContractEdgeId } from "../hir/ids";
import type { LayoutBuilderResult } from "./builder-context";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import type { LayoutCanonicalKeyString } from "./ids";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import type {
  LayoutAbiHiddenParameterFact,
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutEnumFactTable,
  LayoutPlatformAbiFact,
  LayoutPlatformAbiFactTable,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "./layout-program";
import { validateHiddenAbiParameters } from "./source-function-abi";
import type { ClassifyAbiValueInput, LayoutTargetSurface } from "./target-layout";
import { layoutDeterministicTable } from "./type-key";
import { platformEdgeOwnerKey, platformEdgesOwnerKey } from "./layout-owners";
import { lookupLayoutForTypeKey } from "./abi-type-layout";

export interface CheckPlatformEdgeTargetIdsInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
}

export interface ComputePlatformAbiFactsInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly resolver: LayoutTypeResolver;
  readonly sourceFunctionAbiFailures?: ReadonlySet<FunctionId>;
}

export interface ComputePlatformAbiFactsValue {
  readonly platformEdges: LayoutPlatformAbiFactTable;
}

function platformEdgeRootCauseKey(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
): string {
  return String(platformEdgeOwnerKey(edgeId));
}

function layoutPlatformEdgeKeyString(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
): LayoutCanonicalKeyString {
  return String(platformEdgeOwnerKey(edgeId)) as LayoutCanonicalKeyString;
}

function layoutTypeKeyStableDetail(key: LayoutTypeKey): string {
  switch (key.kind) {
    case "source":
      return `source:${String(key.instanceId)}`;
    case "core":
      return `core:${String(key.coreTypeId)}`;
    case "target":
      return `target:${String(key.targetTypeId)}`;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function platformEdgeDiagnostic(
  edge: MonoPlatformContractEdge,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
    readonly rootCauseKey?: string;
    readonly sourceOrigin?: string;
  },
): LayoutDiagnostic {
  return layoutDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    sourceOrigin: input.sourceOrigin ?? edge.sourceOrigin,
    ownerKey: String(platformEdgeOwnerKey(edge.edgeId)),
    rootCauseKey: input.rootCauseKey ?? platformEdgeRootCauseKey(edge.edgeId),
    stableDetail: input.stableDetail,
  });
}

function platformTargetMismatchDiagnostic(
  edge: MonoPlatformContractEdge,
  target: LayoutTargetSurface,
): LayoutDiagnostic {
  return layoutDiagnostic({
    severity: "error",
    code: "LAYOUT_PLATFORM_TARGET_MISMATCH",
    message: "Platform contract edge target ID does not match the selected layout target.",
    sourceOrigin: edge.sourceOrigin,
    ownerKey: String(platformEdgeOwnerKey(edge.edgeId)),
    rootCauseKey: `target:${String(target.targetId)}`,
    stableDetail: `${String(edge.targetId)}->${String(target.targetId)}`,
  });
}

function remapClassifierDiagnostics(
  diagnostics: readonly LayoutDiagnostic[],
  edge: MonoPlatformContractEdge,
): readonly LayoutDiagnostic[] {
  return diagnostics.map((diagnostic) =>
    layoutDiagnostic({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      sourceOrigin: diagnostic.sourceOrigin ?? edge.sourceOrigin,
      ownerKey: String(platformEdgeOwnerKey(edge.edgeId)),
      rootCauseKey: platformEdgeRootCauseKey(edge.edgeId),
      stableDetail: diagnostic.stableDetail,
    }),
  );
}

function classifyPlatformAbiValue(
  target: LayoutTargetSurface,
  input: Omit<ClassifyAbiValueInput, "callConvention">,
): { readonly shape?: LayoutAbiValueShape; readonly diagnostics: readonly LayoutDiagnostic[] } {
  const result = target.abi.classifyValue({
    ...input,
    callConvention: target.abi.platformCallConvention,
  });
  if (result.kind === "error") {
    return { diagnostics: result.diagnostics };
  }
  return { shape: result.shape, diagnostics: [] };
}

function resolveMonoTypeLayout(
  type: MonoCheckedType,
  resolver: LayoutTypeResolver,
  types: LayoutTypeFactTable,
  enums: LayoutEnumFactTable,
  edge: MonoPlatformContractEdge,
): {
  readonly typeKey?: LayoutTypeKey;
  readonly layout?: LayoutTypeFact;
  readonly enumFact?: LayoutEnumFact;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const typeKey = resolver.get(type);
  if (typeKey === undefined) {
    return {
      diagnostics: [
        platformEdgeDiagnostic(edge, {
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout type key for platform edge ABI classification.",
          stableDetail: `missing-type-key:${type.kind}`,
        }),
      ],
    };
  }

  const resolved = lookupLayoutForTypeKey(typeKey, types, enums);
  if (resolved === undefined) {
    return {
      diagnostics: [
        platformEdgeDiagnostic(edge, {
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout fact for platform edge ABI classification.",
          stableDetail: layoutTypeKeyStableDetail(typeKey),
        }),
      ],
    };
  }

  return {
    typeKey,
    layout: resolved.layout,
    ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
    diagnostics: [],
  };
}

function findPlatformFunctionInstance(
  program: MonomorphizedHirProgram,
  sourceFunctionId: FunctionId,
):
  | { readonly kind: "missing" }
  | {
      readonly kind: "ambiguous";
      readonly matches: readonly MonoFunctionInstance[];
    }
  | {
      readonly kind: "resolved";
      readonly functionInstance: MonoFunctionInstance;
    } {
  const matches = program.functions
    .entries()
    .filter((instance) => instance.sourceFunctionId === sourceFunctionId);
  if (matches.length === 0) {
    return { kind: "missing" };
  }
  const sortedMatches = [...matches].sort((left, right) =>
    compareCodeUnitStrings(String(left.instanceId), String(right.instanceId)),
  );
  if (sortedMatches.length > 1) {
    return { kind: "ambiguous", matches: sortedMatches };
  }
  return { kind: "resolved", functionInstance: sortedMatches[0]! };
}

function collectHiddenParameters(
  shapes: readonly LayoutAbiValueShape[],
): readonly LayoutAbiHiddenParameterFact[] {
  const hiddenByIdentity = new Map<LayoutAbiHiddenParameterFact, LayoutAbiHiddenParameterFact>();
  for (const shape of shapes) {
    if (shape.kind === "indirect" && shape.hiddenParameter !== undefined) {
      hiddenByIdentity.set(shape.hiddenParameter, shape.hiddenParameter);
    }
  }
  return [...hiddenByIdentity.values()].sort(
    (left, right) => left.physicalIndex - right.physicalIndex,
  );
}

function monoPlatformEdgeKey(edge: MonoPlatformContractEdge): string {
  return `${String(edge.edgeId.instanceId)}/${String(edge.edgeId.hirId)}`;
}

export function checkPlatformEdgeTargetIds(
  input: CheckPlatformEdgeTargetIdsInput,
): readonly LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const sortedEdges = [...input.program.proofMetadata.platformContractEdges.entries()].sort(
    (left, right) => compareCodeUnitStrings(monoPlatformEdgeKey(left), monoPlatformEdgeKey(right)),
  );

  for (const edge of sortedEdges) {
    if (edge.targetId !== input.target.targetId) {
      diagnostics.push(platformTargetMismatchDiagnostic(edge, input.target));
    }
  }

  return diagnostics;
}

function computePlatformAbiFactForEdge(input: {
  readonly edge: MonoPlatformContractEdge;
  readonly platformFunction: MonoFunctionInstance;
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly resolver: LayoutTypeResolver;
}): LayoutBuilderResult<{ readonly fact: LayoutPlatformAbiFact }> {
  const ownerKey = platformEdgeOwnerKey(input.edge.edgeId);
  const diagnostics: LayoutDiagnostic[] = [];
  const shapes: LayoutAbiValueShape[] = [];
  const argumentsShapes: LayoutAbiValueShape[] = [];

  for (const [index, parameter] of input.platformFunction.signature.parameters.entries()) {
    const resolved = resolveMonoTypeLayout(
      parameter.type,
      input.resolver,
      input.types,
      input.enums,
      input.edge,
    );
    diagnostics.push(...resolved.diagnostics);
    if (resolved.typeKey === undefined || resolved.layout === undefined) {
      continue;
    }

    const classified = classifyPlatformAbiValue(input.target, {
      target: input.targetFacts,
      use: {
        kind: "platformArgument",
        index,
        mode: parameter.mode,
      },
      type: resolved.typeKey,
      layout: resolved.layout,
      ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
    });
    diagnostics.push(...remapClassifierDiagnostics(classified.diagnostics, input.edge));
    if (classified.shape === undefined) {
      if (classified.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        return {
          kind: "error",
          ownerKey,
          dependencies: [{ ownerKey, reason: "abi" }],
          diagnostics,
        };
      }
      continue;
    }
    argumentsShapes.push(classified.shape);
    shapes.push(classified.shape);
  }

  const returnResolved = resolveMonoTypeLayout(
    input.platformFunction.signature.returnType,
    input.resolver,
    input.types,
    input.enums,
    input.edge,
  );
  diagnostics.push(...returnResolved.diagnostics);

  let resultShape: LayoutAbiValueShape | undefined;
  if (returnResolved.typeKey !== undefined && returnResolved.layout !== undefined) {
    const classifiedReturn = classifyPlatformAbiValue(input.target, {
      target: input.targetFacts,
      use: { kind: "platformReturn" },
      type: returnResolved.typeKey,
      layout: returnResolved.layout,
      ...(returnResolved.enumFact !== undefined ? { enumFact: returnResolved.enumFact } : {}),
    });
    diagnostics.push(...remapClassifierDiagnostics(classifiedReturn.diagnostics, input.edge));
    if (classifiedReturn.shape !== undefined) {
      resultShape = classifiedReturn.shape;
      shapes.push(classifiedReturn.shape);
    } else if (classifiedReturn.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return {
        kind: "error",
        ownerKey,
        dependencies: [{ ownerKey, reason: "abi" }],
        diagnostics,
      };
    }
  }

  const hiddenParameters = collectHiddenParameters(shapes);
  diagnostics.push(
    ...validateHiddenAbiParameters({
      functionInstanceId: input.platformFunction.instanceId,
      hiddenParameters,
      shapes,
    }).map((diagnostic) =>
      layoutDiagnostic({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        sourceOrigin: diagnostic.sourceOrigin ?? input.edge.sourceOrigin,
        ownerKey: String(platformEdgeOwnerKey(input.edge.edgeId)),
        rootCauseKey: platformEdgeRootCauseKey(input.edge.edgeId),
        stableDetail: diagnostic.stableDetail,
      }),
    ),
  );

  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errorDiagnostics.length > 0 || resultShape === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics,
    };
  }

  return {
    kind: "ok",
    ownerKey,
    dependencies: [{ ownerKey, reason: "abi" }],
    value: {
      fact: {
        edgeId: input.edge.edgeId,
        primitiveId: input.edge.primitiveId,
        contractId: input.edge.contractId,
        targetId: input.edge.targetId,
        hiddenParameters,
        arguments: argumentsShapes,
        result: resultShape,
        callConvention: input.target.abi.platformCallConvention,
        sourceOrigin: input.edge.sourceOrigin,
      },
    },
    diagnostics,
  };
}

export function computePlatformAbiFacts(
  input: ComputePlatformAbiFactsInput,
): LayoutBuilderResult<ComputePlatformAbiFactsValue> {
  const ownerKey = platformEdgesOwnerKey(String(input.targetFacts.targetId));
  const diagnostics: LayoutDiagnostic[] = [];
  const facts: LayoutPlatformAbiFact[] = [];
  const suppressedSourceFunctions = input.sourceFunctionAbiFailures ?? new Set<FunctionId>();

  const sortedEdges = [...input.program.proofMetadata.platformContractEdges.entries()].sort(
    (left, right) => compareCodeUnitStrings(monoPlatformEdgeKey(left), monoPlatformEdgeKey(right)),
  );

  for (const edge of sortedEdges) {
    if (edge.targetId !== input.target.targetId) {
      continue;
    }

    if (suppressedSourceFunctions.has(edge.sourceFunctionId)) {
      continue;
    }

    const platformFunctionResult = findPlatformFunctionInstance(
      input.program,
      edge.sourceFunctionId,
    );
    if (platformFunctionResult.kind === "missing") {
      diagnostics.push(
        platformEdgeDiagnostic(edge, {
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing monomorphized platform function instance for platform contract edge.",
          stableDetail: `missing-function:${String(edge.sourceFunctionId)}`,
        }),
      );
      continue;
    }
    if (platformFunctionResult.kind === "ambiguous") {
      diagnostics.push(
        platformEdgeDiagnostic(edge, {
          code: "LAYOUT_PLATFORM_FUNCTION_INSTANCE_AMBIGUOUS",
          message:
            "Ambiguous monomorphized platform function instances for platform contract edge.",
          stableDetail: platformFunctionResult.matches
            .map((match) => String(match.instanceId))
            .join("|"),
        }),
      );
      continue;
    }

    const result = computePlatformAbiFactForEdge({
      edge,
      platformFunction: platformFunctionResult.functionInstance,
      target: input.target,
      targetFacts: input.targetFacts,
      types: input.types,
      enums: input.enums,
      resolver: input.resolver,
    });
    diagnostics.push(...result.diagnostics);
    if (result.kind === "ok") {
      facts.push(result.value.fact);
    }
  }

  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errorDiagnostics.length > 0) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics,
    };
  }

  return {
    kind: "ok",
    ownerKey,
    dependencies: [{ ownerKey, reason: "abi" }],
    value: {
      platformEdges: layoutDeterministicTable({
        entries: facts,
        keyOf: (entry) => entry.edgeId,
        keyString: layoutPlatformEdgeKeyString,
      }),
    },
    diagnostics,
  };
}
