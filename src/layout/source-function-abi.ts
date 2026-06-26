import type { MonoInstanceId } from "../mono/ids";
import type {
  MonoFunctionInstance,
  MonomorphizedHirProgram,
  MonoCheckedType,
} from "../mono/mono-hir";
import type { ParameterId } from "../semantic/ids";
import type { LayoutBuilderResult } from "./builder-context";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import type { LayoutCanonicalKeyString } from "./ids";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import type {
  LayoutAbiHiddenParameterFact,
  LayoutAbiParameterFact,
  LayoutAbiReturnFact,
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutEnumFactTable,
  LayoutFunctionAbiFact,
  LayoutFunctionAbiFactTable,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "./layout-program";
import type { ClassifyAbiValueInput, LayoutTargetSurface, TargetAbiSurface } from "./target-layout";
import { layoutDeterministicTable } from "./type-key";
import { lookupLayoutForTypeKey } from "./abi-type-layout";
import { functionAbiOwnerKey, functionsAbiOwnerKey } from "./layout-owners";

export interface ComputeSourceFunctionAbiFactsInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly resolver: LayoutTypeResolver;
}

export interface ComputeSourceFunctionAbiFactsValue {
  readonly functions: LayoutFunctionAbiFactTable;
}

export interface ComputeFunctionAbiFactInput {
  readonly functionInstance: MonoFunctionInstance;
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly resolver: LayoutTypeResolver;
}

export interface ComputeFunctionAbiFactValue {
  readonly fact: LayoutFunctionAbiFact;
}

export interface ClassifySourceAbiParameterInput {
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly parameterId: ParameterId;
  readonly mode: "observe" | "consume";
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly enumFact?: LayoutEnumFact;
  readonly sourceOrigin: string;
}

export interface ClassifySourceAbiReturnInput {
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly enumFact?: LayoutEnumFact;
  readonly sourceOrigin: string;
}

export interface ValidateHiddenAbiParametersInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly hiddenParameters: readonly LayoutAbiHiddenParameterFact[];
  readonly shapes: readonly LayoutAbiValueShape[];
}

function functionAbiRootCauseKey(functionInstanceId: MonoInstanceId): string {
  return `abi:${String(functionInstanceId)}`;
}

function functionAbiDiagnostic(
  functionInstanceId: MonoInstanceId,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
    readonly sourceOrigin?: string;
  },
): LayoutDiagnostic {
  const ownerKey = String(functionAbiOwnerKey(functionInstanceId));
  return layoutDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    sourceOrigin: input.sourceOrigin,
    ownerKey,
    rootCauseKey: functionAbiRootCauseKey(functionInstanceId),
    stableDetail: input.stableDetail,
  });
}

function layoutFunctionAbiKeyString(instanceId: MonoInstanceId): LayoutCanonicalKeyString {
  return `function:${String(instanceId)}` as LayoutCanonicalKeyString;
}

function layoutTypeKeyString(key: LayoutTypeKey): LayoutCanonicalKeyString {
  switch (key.kind) {
    case "source":
      return `source:${String(key.instanceId)}` as LayoutCanonicalKeyString;
    case "core":
      return `core:${String(key.coreTypeId)}` as LayoutCanonicalKeyString;
    case "target":
      return `target:${String(key.targetTypeId)}` as LayoutCanonicalKeyString;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function layoutTypeKeyStableDetail(key: LayoutTypeKey): string {
  return layoutTypeKeyString(key);
}

function classifyAbiValue(
  abi: TargetAbiSurface,
  input: Omit<ClassifyAbiValueInput, "callConvention"> & {
    readonly callConvention?: ClassifyAbiValueInput["callConvention"];
  },
): { readonly shape?: LayoutAbiValueShape; readonly diagnostics: readonly LayoutDiagnostic[] } {
  const result = abi.classifyValue({
    ...input,
    callConvention: input.callConvention ?? abi.sourceCallConvention,
  });
  if (result.kind === "error") {
    return { diagnostics: result.diagnostics };
  }
  return { shape: result.shape, diagnostics: [] };
}

export function classifySourceAbiParameter(input: ClassifySourceAbiParameterInput): {
  readonly fact?: LayoutAbiParameterFact;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const classification = classifyAbiValue(input.target.abi, {
    target: input.targetFacts,
    use: {
      kind: "parameter",
      parameterId: input.parameterId,
      mode: input.mode,
    },
    type: input.type,
    layout: input.layout,
    ...(input.enumFact !== undefined ? { enumFact: input.enumFact } : {}),
  });

  if (classification.shape === undefined) {
    return { diagnostics: classification.diagnostics };
  }

  return {
    fact: {
      parameterId: input.parameterId,
      mode: input.mode,
      type: input.type,
      layout: input.layout,
      shape: classification.shape,
      sourceOrigin: input.sourceOrigin,
    },
    diagnostics: classification.diagnostics,
  };
}

export function classifySourceAbiReturn(input: ClassifySourceAbiReturnInput): {
  readonly fact?: LayoutAbiReturnFact;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const classification = classifyAbiValue(input.target.abi, {
    target: input.targetFacts,
    use: { kind: "return" },
    type: input.type,
    layout: input.layout,
    ...(input.enumFact !== undefined ? { enumFact: input.enumFact } : {}),
  });

  if (classification.shape === undefined) {
    return { diagnostics: classification.diagnostics };
  }

  return {
    fact: {
      type: input.type,
      layout: input.layout,
      shape: classification.shape,
      sourceOrigin: input.sourceOrigin,
    },
    diagnostics: classification.diagnostics,
  };
}

export function validateHiddenAbiParameters(
  input: ValidateHiddenAbiParametersInput,
): readonly LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const referenceCountBySlot = new Map<string, number>();

  for (const shape of input.shapes) {
    if (shape.kind !== "indirect" || shape.hiddenParameter === undefined) {
      continue;
    }
    const slotKey = hiddenParameterSlotKey(shape.hiddenParameter);
    referenceCountBySlot.set(slotKey, (referenceCountBySlot.get(slotKey) ?? 0) + 1);
  }

  const listedCountBySlot = new Map<string, number>();
  for (const hidden of input.hiddenParameters) {
    const slotKey = hiddenParameterSlotKey(hidden);
    listedCountBySlot.set(slotKey, (listedCountBySlot.get(slotKey) ?? 0) + 1);
  }

  for (const [slotKey, count] of listedCountBySlot.entries()) {
    if (count > 1) {
      diagnostics.push(
        functionAbiDiagnostic(input.functionInstanceId, {
          code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
          message: "Hidden ABI parameter physical slot is declared more than once.",
          stableDetail: `duplicate-slot:${slotKey}`,
        }),
      );
    }
  }

  for (const [slotKey, referenceCount] of referenceCountBySlot.entries()) {
    const listedCount = listedCountBySlot.get(slotKey) ?? 0;
    if (listedCount !== 1) {
      diagnostics.push(
        functionAbiDiagnostic(input.functionInstanceId, {
          code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
          message:
            "Hidden ABI parameter referenced by an indirect shape is missing from the hidden parameter list.",
          stableDetail: `missing-list:${slotKey}`,
        }),
      );
    }
    if (referenceCount > 1) {
      diagnostics.push(
        functionAbiDiagnostic(input.functionInstanceId, {
          code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
          message: "Hidden ABI parameter is referenced by more than one indirect shape.",
          stableDetail: `duplicate-reference:${slotKey}`,
        }),
      );
    }
  }

  for (const hidden of input.hiddenParameters) {
    const slotKey = hiddenParameterSlotKey(hidden);
    if (!referenceCountBySlot.has(slotKey)) {
      diagnostics.push(
        functionAbiDiagnostic(input.functionInstanceId, {
          code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
          message: "Hidden ABI parameter is listed but not referenced by any indirect shape.",
          stableDetail: `unreferenced:${slotKey}`,
        }),
      );
    }
  }

  const sortedHidden = [...input.hiddenParameters].sort(
    (left, right) => left.physicalIndex - right.physicalIndex,
  );
  for (let index = 0; index < input.hiddenParameters.length; index += 1) {
    if (input.hiddenParameters[index] !== sortedHidden[index]) {
      diagnostics.push(
        functionAbiDiagnostic(input.functionInstanceId, {
          code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
          message: "Hidden ABI parameters must be ordered by physical argument index.",
          stableDetail: "physical-order",
        }),
      );
      break;
    }
  }

  const physicalIndexCounts = new Map<number, number>();
  for (const hidden of input.hiddenParameters) {
    physicalIndexCounts.set(
      hidden.physicalIndex,
      (physicalIndexCounts.get(hidden.physicalIndex) ?? 0) + 1,
    );
  }
  for (const [physicalIndex, count] of physicalIndexCounts.entries()) {
    if (count > 1) {
      diagnostics.push(
        functionAbiDiagnostic(input.functionInstanceId, {
          code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
          message: "Hidden ABI parameters must occupy distinct physical argument indices.",
          stableDetail: `duplicate-physical-index:${physicalIndex}`,
        }),
      );
    }
  }

  return diagnostics;
}

function hiddenParameterSlotKey(hidden: LayoutAbiHiddenParameterFact): string {
  return `${hidden.kind}:${hidden.physicalIndex}`;
}

function collectHiddenParameters(
  shapes: readonly LayoutAbiValueShape[],
): readonly LayoutAbiHiddenParameterFact[] {
  const hiddenBySlot = new Map<string, LayoutAbiHiddenParameterFact>();
  for (const shape of shapes) {
    if (shape.kind === "indirect" && shape.hiddenParameter !== undefined) {
      hiddenBySlot.set(hiddenParameterSlotKey(shape.hiddenParameter), shape.hiddenParameter);
    }
  }
  return [...hiddenBySlot.values()].sort((left, right) => left.physicalIndex - right.physicalIndex);
}

function resolveMonoTypeLayout(
  type: MonoCheckedType,
  resolver: LayoutTypeResolver,
  types: LayoutTypeFactTable,
  enums: LayoutEnumFactTable,
  functionInstanceId: MonoInstanceId,
  sourceOrigin: string,
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
        functionAbiDiagnostic(functionInstanceId, {
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout type key for ABI classification.",
          stableDetail: `missing-type-key:${type.kind}`,
          sourceOrigin,
        }),
      ],
    };
  }

  const resolved = lookupLayoutForTypeKey(typeKey, types, enums);
  if (resolved === undefined) {
    return {
      diagnostics: [
        functionAbiDiagnostic(functionInstanceId, {
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout fact for ABI classification.",
          stableDetail: layoutTypeKeyStableDetail(typeKey),
          sourceOrigin,
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

function remapClassifierDiagnostics(
  diagnostics: readonly LayoutDiagnostic[],
  functionInstanceId: MonoInstanceId,
  sourceOrigin: string,
): readonly LayoutDiagnostic[] {
  return diagnostics.map((diagnostic) =>
    layoutDiagnostic({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      sourceOrigin: diagnostic.sourceOrigin ?? sourceOrigin,
      ownerKey: String(functionAbiOwnerKey(functionInstanceId)),
      rootCauseKey: functionAbiRootCauseKey(functionInstanceId),
      stableDetail: diagnostic.stableDetail,
    }),
  );
}

function computeFunctionAbiFactForInstance(input: {
  readonly functionInstance: MonoFunctionInstance;
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly resolver: LayoutTypeResolver;
}): LayoutBuilderResult<ComputeFunctionAbiFactValue> {
  const ownerKey = functionAbiOwnerKey(input.functionInstance.instanceId);
  const diagnostics: LayoutDiagnostic[] = [];
  const shapes: LayoutAbiValueShape[] = [];

  let receiver: LayoutAbiParameterFact | undefined;
  if (input.functionInstance.signature.receiver !== undefined) {
    const receiverRecord = input.functionInstance.signature.receiver;
    const resolved = resolveMonoTypeLayout(
      receiverRecord.type,
      input.resolver,
      input.types,
      input.enums,
      input.functionInstance.instanceId,
      input.functionInstance.sourceOrigin,
    );
    diagnostics.push(...resolved.diagnostics);
    if (resolved.typeKey !== undefined && resolved.layout !== undefined) {
      const classified = classifySourceAbiParameter({
        target: input.target,
        targetFacts: input.targetFacts,
        parameterId: receiverRecord.parameterId,
        mode: receiverRecord.mode,
        type: resolved.typeKey,
        layout: resolved.layout,
        ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
        sourceOrigin: input.functionInstance.sourceOrigin,
      });
      diagnostics.push(
        ...remapClassifierDiagnostics(
          classified.diagnostics,
          input.functionInstance.instanceId,
          input.functionInstance.sourceOrigin,
        ),
      );
      if (classified.fact !== undefined) {
        receiver = classified.fact;
        shapes.push(classified.fact.shape);
      } else if (classified.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        return {
          kind: "error",
          ownerKey,
          dependencies: [{ ownerKey, reason: "abi" }],
          diagnostics,
        };
      }
    }
  }

  const parameters: LayoutAbiParameterFact[] = [];
  for (const parameter of input.functionInstance.signature.parameters) {
    const parameterOrigin = input.functionInstance.sourceOrigin;
    const resolved = resolveMonoTypeLayout(
      parameter.type,
      input.resolver,
      input.types,
      input.enums,
      input.functionInstance.instanceId,
      parameterOrigin,
    );
    diagnostics.push(...resolved.diagnostics);
    if (resolved.typeKey === undefined || resolved.layout === undefined) {
      continue;
    }

    const classified = classifySourceAbiParameter({
      target: input.target,
      targetFacts: input.targetFacts,
      parameterId: parameter.parameterId,
      mode: parameter.mode,
      type: resolved.typeKey,
      layout: resolved.layout,
      ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
      sourceOrigin: parameterOrigin,
    });
    diagnostics.push(
      ...remapClassifierDiagnostics(
        classified.diagnostics,
        input.functionInstance.instanceId,
        parameterOrigin,
      ),
    );
    if (classified.fact === undefined) {
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
    parameters.push(classified.fact);
    shapes.push(classified.fact.shape);
  }

  const returnResolved = resolveMonoTypeLayout(
    input.functionInstance.signature.returnType,
    input.resolver,
    input.types,
    input.enums,
    input.functionInstance.instanceId,
    input.functionInstance.sourceOrigin,
  );
  diagnostics.push(...returnResolved.diagnostics);

  let returnValue: LayoutAbiReturnFact | undefined;
  if (returnResolved.typeKey !== undefined && returnResolved.layout !== undefined) {
    const classifiedReturn = classifySourceAbiReturn({
      target: input.target,
      targetFacts: input.targetFacts,
      type: returnResolved.typeKey,
      layout: returnResolved.layout,
      ...(returnResolved.enumFact !== undefined ? { enumFact: returnResolved.enumFact } : {}),
      sourceOrigin: input.functionInstance.sourceOrigin,
    });
    diagnostics.push(
      ...remapClassifierDiagnostics(
        classifiedReturn.diagnostics,
        input.functionInstance.instanceId,
        input.functionInstance.sourceOrigin,
      ),
    );
    if (classifiedReturn.fact !== undefined) {
      returnValue = classifiedReturn.fact;
      shapes.push(classifiedReturn.fact.shape);
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
      functionInstanceId: input.functionInstance.instanceId,
      hiddenParameters,
      shapes,
    }),
  );

  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errorDiagnostics.length > 0 || returnValue === undefined) {
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
        functionInstanceId: input.functionInstance.instanceId,
        sourceFunctionId: input.functionInstance.sourceFunctionId,
        hiddenParameters,
        ...(receiver !== undefined ? { receiver } : {}),
        parameters,
        returnValue,
        callConvention: input.target.abi.sourceCallConvention,
        sourceOrigin: input.functionInstance.sourceOrigin,
      },
    },
    diagnostics,
  };
}

export function computeFunctionAbiFact(
  input: ComputeFunctionAbiFactInput,
): LayoutBuilderResult<ComputeFunctionAbiFactValue> {
  return computeFunctionAbiFactForInstance(input);
}

export function computeSourceFunctionAbiFacts(
  input: ComputeSourceFunctionAbiFactsInput,
): LayoutBuilderResult<ComputeSourceFunctionAbiFactsValue> {
  const ownerKey = functionsAbiOwnerKey(String(input.targetFacts.targetId));
  const diagnostics: LayoutDiagnostic[] = [];
  const facts: LayoutFunctionAbiFact[] = [];

  const sortedFunctions = [...input.program.functions.entries()].sort((left, right) =>
    compareCodeUnitStrings(String(left.instanceId), String(right.instanceId)),
  );

  for (const functionInstance of sortedFunctions) {
    const result = computeFunctionAbiFactForInstance({
      functionInstance,
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
      functions: layoutDeterministicTable({
        entries: facts,
        keyOf: (entry) => entry.functionInstanceId,
        keyString: layoutFunctionAbiKeyString,
      }),
    },
    diagnostics,
  };
}
