import type { HirPlatformContractEdgeId } from "../hir/ids";
import type { FunctionId } from "../semantic/ids";
import type { MonoInstanceId } from "../mono/ids";
import type {
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonomorphizedHirProgram,
} from "../mono/mono-hir";
import { compareCodeUnitStrings } from "./deterministic-sort";
import type { LayoutBuilderContext } from "./builder-context";
import { layoutDiagnostic } from "./diagnostics";
import { functionAbiOwnerKey, validatedBufferValueStorageOwnerKey } from "./layout-owners";
import type {
  ComputeRepresentationLayoutFactsInput,
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutFactProgram,
  LayoutFieldFact,
  LayoutFunctionAbiFact,
  LayoutImageEntryAbiFact,
  LayoutPlatformAbiFact,
  LayoutTypeFactTable,
  LayoutValidatedBufferFact,
  TargetLayoutFacts,
} from "./layout-program";
import { layoutFieldKeyString, layoutTypeKeyString } from "./type-key";
import { validateHiddenAbiParameters } from "./source-function-abi";
import { layoutPlatformEdgeKeyString } from "./layout-fact-builder-support";
import type { LayoutTypeResolver } from "./layout-type-resolver";

export interface LayoutFactBuilderState {
  readonly input: ComputeRepresentationLayoutFactsInput;
  targetFacts?: TargetLayoutFacts;
  types?: LayoutTypeFactTable;
  fields?: readonly LayoutFieldFact[];
  enums?: readonly LayoutEnumFact[];
  validatedBuffers?: readonly LayoutValidatedBufferFact[];
  imageDevices?: LayoutFactProgram["imageDevices"];
  functions?: LayoutFactProgram["functions"];
  platformEdges?: LayoutFactProgram["platformEdges"];
  imageEntry?: LayoutImageEntryAbiFact;
  resolver?: LayoutTypeResolver;
  sourceFunctionAbiFailures?: Set<FunctionId>;
}

function factTableInconsistencyDiagnostic(
  ownerKey: string,
  stableDetail: string,
  message: string,
): ReturnType<typeof layoutDiagnostic> {
  return layoutDiagnostic({
    severity: "error",
    code: "LAYOUT_FACT_TABLE_INCONSISTENCY",
    message,
    ownerKey,
    rootCauseKey: "layout-fact-table",
    stableDetail,
  });
}

function collectAbiValueShapes(
  fact: LayoutFunctionAbiFact | LayoutPlatformAbiFact,
): readonly LayoutAbiValueShape[] {
  if ("parameters" in fact) {
    const shapes: LayoutAbiValueShape[] = [];
    if (fact.receiver !== undefined) {
      shapes.push(fact.receiver.shape);
    }
    for (const parameter of fact.parameters) {
      shapes.push(parameter.shape);
    }
    shapes.push(fact.returnValue.shape);
    return shapes;
  }

  return [...fact.arguments, fact.result];
}

function checkHiddenAbiParameterConsistency(
  ownerKey: string,
  functionInstanceId: MonoInstanceId,
  hiddenParameters: LayoutFunctionAbiFact["hiddenParameters"],
  shapes: readonly LayoutAbiValueShape[],
): readonly ReturnType<typeof layoutDiagnostic>[] {
  return validateHiddenAbiParameters({
    functionInstanceId,
    hiddenParameters,
    shapes,
  }).map((diagnostic) =>
    layoutDiagnostic({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.sourceOrigin !== undefined ? { sourceOrigin: diagnostic.sourceOrigin } : {}),
      ownerKey,
      rootCauseKey: "layout-fact-table",
      stableDetail: diagnostic.stableDetail,
    }),
  );
}

function buildPlatformFunctionLookup(program: MonomorphizedHirProgram): {
  readonly edgeToFunction: ReadonlyMap<string, MonoFunctionInstance>;
} {
  const functionsBySourceId = new Map<string, MonoFunctionInstance[]>();
  for (const instance of program.functions.entries()) {
    const sourceFunctionId = String(instance.sourceFunctionId);
    const list = functionsBySourceId.get(sourceFunctionId) ?? [];
    list.push(instance);
    functionsBySourceId.set(sourceFunctionId, list);
  }
  for (const [sourceFunctionId, instances] of functionsBySourceId.entries()) {
    instances.sort((left, right) =>
      compareCodeUnitStrings(String(left.instanceId), String(right.instanceId)),
    );
    functionsBySourceId.set(sourceFunctionId, instances);
  }

  const edgeToFunction = new Map<string, MonoFunctionInstance>();
  for (const edge of program.proofMetadata.platformContractEdges.entries()) {
    const edgeKey = `${String(edge.edgeId.instanceId)}:${String(edge.edgeId.hirId)}`;
    const matches = functionsBySourceId.get(String(edge.sourceFunctionId));
    if (matches !== undefined && matches.length > 0) {
      edgeToFunction.set(edgeKey, matches[0]!);
    }
  }

  return { edgeToFunction };
}

function findPlatformFunctionForEdge(
  lookup: ReadonlyMap<string, MonoFunctionInstance>,
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
): MonoFunctionInstance | undefined {
  return lookup.get(`${String(edgeId.instanceId)}:${String(edgeId.hirId)}`);
}

export function runLayoutFactConsistencyChecks(
  state: LayoutFactBuilderState,
  context: LayoutBuilderContext,
): void {
  if (state.types === undefined) {
    return;
  }

  for (const fieldFact of state.fields ?? []) {
    const ownerType = state.types.get(fieldFact.owner);
    if (ownerType === undefined) {
      context.reportDiagnostic(
        factTableInconsistencyDiagnostic(
          `field:${layoutFieldKeyString({ owner: fieldFact.owner, fieldId: fieldFact.fieldId })}`,
          `missing-owner:${layoutTypeKeyString(fieldFact.owner)}`,
          "Layout field fact references a missing owner type fact.",
        ),
      );
    }
  }

  for (const enumFact of state.enums ?? []) {
    const ownerType = state.types.get(enumFact.owner);
    if (ownerType === undefined || ownerType.representation.kind !== "enum") {
      context.reportDiagnostic(
        factTableInconsistencyDiagnostic(
          `enum:${layoutTypeKeyString(enumFact.owner)}`,
          `missing-owner:${layoutTypeKeyString(enumFact.owner)}`,
          "Layout enum fact references a missing or non-enum owner type fact.",
        ),
      );
    }
  }

  for (const bufferFact of state.validatedBuffers ?? []) {
    const ownerType = state.types.get(bufferFact.typeKey);
    const hiddenFields = ownerType?.aggregateStorage?.hiddenFields ?? [];
    const sourcePointer = hiddenFields[0];
    const sourceLength = hiddenFields[1];

    if (
      sourcePointer === undefined ||
      sourceLength === undefined ||
      bufferFact.valueStorage.sourcePointer !== sourcePointer ||
      bufferFact.valueStorage.sourceLength !== sourceLength
    ) {
      context.reportDiagnostic(
        factTableInconsistencyDiagnostic(
          String(validatedBufferValueStorageOwnerKey(bufferFact.instanceId)),
          "hidden-storage-mismatch",
          "Validated-buffer value storage must reference aggregate hidden source pointer and length fields.",
        ),
      );
    }
  }

  if (state.functions !== undefined) {
    for (const functionFact of state.functions.entries()) {
      for (const diagnostic of checkHiddenAbiParameterConsistency(
        String(functionAbiOwnerKey(functionFact.functionInstanceId)),
        functionFact.functionInstanceId,
        functionFact.hiddenParameters,
        collectAbiValueShapes(functionFact),
      )) {
        context.reportDiagnostic(diagnostic);
      }
    }
  }

  if (state.platformEdges !== undefined) {
    const platformFunctionLookup = buildPlatformFunctionLookup(state.input.program);
    for (const platformFact of state.platformEdges.entries()) {
      const platformFunction = findPlatformFunctionForEdge(
        platformFunctionLookup.edgeToFunction,
        platformFact.edgeId,
      );
      if (platformFunction === undefined) {
        continue;
      }
      for (const diagnostic of checkHiddenAbiParameterConsistency(
        layoutPlatformEdgeKeyString(platformFact.edgeId),
        platformFunction.instanceId,
        platformFact.hiddenParameters,
        collectAbiValueShapes(platformFact),
      )) {
        context.reportDiagnostic(diagnostic);
      }
    }
  }
}
