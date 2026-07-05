import {
  computeSourceAggregateLayout,
  layoutUnsupportedSourceKindDiagnosticCode,
} from "./aggregate-layout";
import { computeEnumLayout } from "./enum-layout";
import { computeImageDeviceFacts } from "./image-device-layout";
import { computeImageEntryAbiFact } from "./image-entry-abi";
import { checkPlatformEdgeTargetIds, computePlatformAbiFacts } from "./platform-abi";
import { seedPrimitiveTypeFacts } from "./primitive-layout";
import { computeSourceFunctionAbiFacts } from "./source-function-abi";
import { computeDerivedFieldFacts } from "./validated-buffer-derived";
import {
  computeValidatedBufferFieldFacts,
  derivedFieldIdsBefore,
  layoutFieldIdsBefore,
  layoutFieldWireByFieldIdFromBuffer,
} from "./validated-buffer-fields";
import { computeValidatedBufferValueStorage } from "./validated-buffer-value-storage";
import { createLayoutBuilderContext, type LayoutBuilderContext } from "./builder-context";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { finalizeLayoutDiagnostics, layoutDiagnostic } from "./diagnostics";
import { buildLayoutTypeResolver, type LayoutTypeResolver } from "./layout-type-resolver";
import type { FieldId } from "../semantic/ids";
import type {
  ComputeRepresentationLayoutFactsInput,
  ComputeRepresentationLayoutFactsResult,
  LayoutEnumFact,
  LayoutFactProgram,
  LayoutFieldFact,
  LayoutIntegerRange,
  LayoutTypeFact,
  LayoutValidatedBufferDerivedFact,
  LayoutValidatedBufferFact,
} from "./layout-program";
import { layoutDeterministicTable, layoutFieldKeyString } from "./type-key";
import { validateLayoutTargetSurface } from "./target-layout";
import { collectReachableErrorTypeDiagnostics } from "./layout-reachable-errors";
import { collectMonoInvariantDiagnostics } from "./mono-invariant-checker";
import {
  AGGREGATE_SOURCE_KINDS,
  buildNestedSourceTypes,
  buildSourceTypeKeys,
  collectSourceFunctionAbiFailures,
  emptyFunctionAbiTable,
  emptyImageDeviceTable,
  emptyPlatformAbiTable,
  emptyValidatedBufferTable,
  layoutEnumKeyString,
  layoutValidatedBufferKeyString,
  mergeTypeFacts,
  recordBuilderResult,
  sourceTypeCacheKey,
} from "./layout-fact-builder-support";
import {
  runLayoutFactConsistencyChecks,
  type LayoutFactBuilderState,
} from "./layout-fact-builder-consistency";
import {
  typeLayoutOwnerKey,
  validatedBufferDerivedOwnerKey,
  validatedBufferRootCauseKey,
  validatedBufferValueStorageOwnerKey,
} from "./layout-owners";

function enumPayloadFieldCount(typeInstance: {
  readonly enumCases: readonly { readonly payloadFieldIds: readonly unknown[] }[];
}): number {
  return typeInstance.enumCases.reduce(
    (total, caseRecord) => total + caseRecord.payloadFieldIds.length,
    0,
  );
}

function createLayoutFactBuilderContext(
  input: ComputeRepresentationLayoutFactsInput,
): LayoutFactBuilderState & {
  readonly context: LayoutBuilderContext;
  runTargetValidation(): void;
  runTypeResolution(): void;
  runSourceRepresentations(): void;
  runValidatedBuffers(): void;
  runAbiFacts(): void;
  runConsistencyChecks(): void;
  finish(): ComputeRepresentationLayoutFactsResult;
} {
  const context = createLayoutBuilderContext();
  const state: LayoutFactBuilderState = { input };

  return {
    ...state,
    context,
    runTargetValidation(): void {
      const targetResult = validateLayoutTargetSurface(input.target);
      recordBuilderResult(context, targetResult, String(input.target.targetId));
      if (targetResult.kind === "ok") {
        state.targetFacts = targetResult.value;
      }

      for (const diagnostic of checkPlatformEdgeTargetIds({
        program: input.program,
        target: input.target,
      })) {
        context.reportDiagnostic(diagnostic);
      }

      for (const diagnostic of collectReachableErrorTypeDiagnostics(input.program)) {
        context.reportDiagnostic(diagnostic);
      }

      for (const diagnostic of collectMonoInvariantDiagnostics(input.program)) {
        context.reportDiagnostic(diagnostic);
      }
    },

    runTypeResolution(): void {
      if (state.targetFacts === undefined) {
        return;
      }

      const primitiveResult = seedPrimitiveTypeFacts(input.target);
      recordBuilderResult(context, primitiveResult, String(input.target.targetId));
      if (primitiveResult.kind !== "ok") {
        return;
      }

      const resolverResult = buildLayoutTypeResolver({
        program: input.program,
        targetFacts: state.targetFacts,
        primitiveTypes: primitiveResult.value.types,
      });
      recordBuilderResult(context, resolverResult, String(input.target.targetId));
      if (resolverResult.kind !== "ok") {
        state.types = primitiveResult.value.types;
        return;
      }

      state.resolver = resolverResult.value.resolver;
      state.types = mergeTypeFacts(primitiveResult.value.types, []);
    },

    runSourceRepresentations(): void {
      if (state.targetFacts === undefined || state.types === undefined) {
        return;
      }

      const sourceTypeKeys = buildSourceTypeKeys(input.program);
      const nestedSourceTypes = buildNestedSourceTypes(input.program);
      const precomputedTypeFacts = new Map<string, LayoutTypeFact>();
      const sourceTypeFacts: LayoutTypeFact[] = [];
      const fieldFacts: LayoutFieldFact[] = [];
      const enumFacts: LayoutEnumFact[] = [];

      const sortedTypes = [...input.program.types.entries()].sort((left, right) =>
        compareCodeUnitStrings(String(left.instanceId), String(right.instanceId)),
      );

      const sortedEnumTypes = sortedTypes
        .filter((typeInstance) => typeInstance.sourceKind === "enum")
        .sort((left, right) => {
          const payloadOrder = enumPayloadFieldCount(left) - enumPayloadFieldCount(right);
          return payloadOrder === 0
            ? compareCodeUnitStrings(String(left.instanceId), String(right.instanceId))
            : payloadOrder;
        });
      for (const typeInstance of sortedEnumTypes) {
        const enumResult = computeEnumLayout({
          typeInstance,
          target: input.target,
          cases: typeInstance.enumCases.map((caseRecord) => caseRecord.name),
          candidateTagTypes: input.target.enumPolicy.candidateTagTypes,
          discriminantStart: input.target.enumPolicy.discriminantStart,
          typeResolver: state.resolver,
          typeFacts: state.types,
          precomputedTypeFacts,
          targetFacts: state.targetFacts,
          nestedSourceTypes,
          sourceTypeKeys,
        });
        recordBuilderResult(context, enumResult, String(input.target.targetId));
        if (enumResult.kind === "ok") {
          enumFacts.push(enumResult.value.enumFact);
          sourceTypeFacts.push(enumResult.value.typeFact);
          fieldFacts.push(...enumResult.value.fieldFacts);
          precomputedTypeFacts.set(
            sourceTypeCacheKey(enumResult.value.typeFact.key),
            enumResult.value.typeFact,
          );
        }
      }

      for (const typeInstance of sortedTypes) {
        if (typeInstance.sourceKind === "enum") {
          continue;
        }
        if (typeInstance.sourceKind === "validatedBuffer") {
          continue;
        }

        if (!AGGREGATE_SOURCE_KINDS.has(typeInstance.sourceKind)) {
          context.reportIssue({
            ownerKey: typeLayoutOwnerKey(typeInstance.instanceId),
            dependencies: [
              {
                ownerKey: typeLayoutOwnerKey(typeInstance.instanceId),
                reason: "type",
              },
            ],
            diagnostics: [
              layoutDiagnostic({
                severity: "error",
                code: layoutUnsupportedSourceKindDiagnosticCode(typeInstance.sourceKind),
                message: `Source kind '${typeInstance.sourceKind}' has no by-value runtime representation.`,
                ownerKey: String(typeLayoutOwnerKey(typeInstance.instanceId)),
                rootCauseKey: String(typeLayoutOwnerKey(typeInstance.instanceId)),
                stableDetail: typeInstance.sourceKind,
                sourceOrigin: typeInstance.sourceOrigin,
              }),
            ],
          });
          continue;
        }

        const aggregateResult = computeSourceAggregateLayout({
          owner: { kind: "source", instanceId: typeInstance.instanceId },
          sourceKind: typeInstance.sourceKind,
          fields: typeInstance.fields.map((field) => ({
            fieldId: field.fieldId,
            name: field.name,
            type: field.type,
            sourceOrigin: field.sourceOrigin,
          })),
          targetFacts: state.targetFacts,
          primitiveFacts: state.types,
          nestedSourceTypes,
          sourceTypeKeys,
          sourceOrigin: typeInstance.sourceOrigin,
          precomputedTypeFacts,
        });
        recordBuilderResult(context, aggregateResult, String(input.target.targetId));
        if (aggregateResult.kind === "ok") {
          sourceTypeFacts.push(aggregateResult.value.typeFact);
          fieldFacts.push(...aggregateResult.value.fieldFacts);
          precomputedTypeFacts.set(
            sourceTypeCacheKey(aggregateResult.value.typeFact.key),
            aggregateResult.value.typeFact,
          );
        }
      }

      state.types = mergeTypeFacts(state.types, sourceTypeFacts);
      state.fields = fieldFacts;
      state.enums = enumFacts;

      const imageDeviceResult = computeImageDeviceFacts({
        program: input.program,
        target: input.target,
        types: state.types,
        resolver: state.resolver,
      });
      recordBuilderResult(context, imageDeviceResult, String(input.target.targetId));
      if (imageDeviceResult.kind === "ok") {
        state.imageDevices = imageDeviceResult.value.devices;
      }
    },

    runValidatedBuffers(): void {
      if (
        state.targetFacts === undefined ||
        state.types === undefined ||
        state.resolver === undefined
      ) {
        return;
      }

      const bufferFacts: LayoutValidatedBufferFact[] = [];
      const parameterFieldFacts: LayoutFieldFact[] = [];
      const validatedBufferTypeFacts: LayoutTypeFact[] = [];

      const sortedBuffers = [...input.program.validatedBuffers.entries()].sort((left, right) =>
        compareCodeUnitStrings(String(left.instanceId), String(right.instanceId)),
      );

      for (const buffer of sortedBuffers) {
        const typeInstance = input.program.types.get(buffer.instanceId);
        if (typeInstance === undefined) {
          context.reportDiagnostic(
            layoutDiagnostic({
              severity: "error",
              code: "LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH",
              message: "Validated-buffer type instance is missing from mono type table.",
              ownerKey: String(validatedBufferValueStorageOwnerKey(buffer.instanceId)),
              rootCauseKey: validatedBufferRootCauseKey(buffer.instanceId),
              stableDetail: "missing-type-instance",
            }),
          );
          continue;
        }

        const valueStorageResult = computeValidatedBufferValueStorage({
          buffer,
          typeInstance,
          target: input.target,
          targetFacts: state.targetFacts,
          primitiveFacts: state.types,
        });
        recordBuilderResult(context, valueStorageResult, String(input.target.targetId));

        const fieldFactsResult = computeValidatedBufferFieldFacts({
          buffer,
          target: input.target,
          program: input.program,
          targetFacts: state.targetFacts,
          typeResolver: state.resolver,
        });
        recordBuilderResult(context, fieldFactsResult, String(input.target.targetId));

        if (valueStorageResult.kind !== "ok" || fieldFactsResult.kind !== "ok") {
          continue;
        }

        parameterFieldFacts.push(...valueStorageResult.value.parameterFieldFacts);
        validatedBufferTypeFacts.push(valueStorageResult.value.ownerTypeFact);

        const derivedFields: LayoutValidatedBufferDerivedFact[] = [];
        const derivedFieldRangeByFieldId = new Map<FieldId, LayoutIntegerRange>();
        const parameterFieldIds = new Set(
          buffer.parameterFields.map((field) => String(field.fieldId)),
        );
        for (const derivedField of buffer.derivedFields) {
          const availableLayoutFieldIds = layoutFieldIdsBefore(buffer, derivedField.field.fieldId);
          const resolvedType = state.resolver?.get(derivedField.field.type);
          if (resolvedType === undefined) {
            context.reportDiagnostic(
              layoutDiagnostic({
                severity: "error",
                code: "LAYOUT_INVALID_LAYOUT_TERM",
                message: "Derived field type cannot be resolved.",
                ownerKey: String(
                  validatedBufferDerivedOwnerKey(buffer.instanceId, derivedField.field.fieldId),
                ),
                rootCauseKey: validatedBufferRootCauseKey(buffer.instanceId),
                stableDetail: derivedField.field.name,
                sourceOrigin: derivedField.field.sourceOrigin,
              }),
            );
            continue;
          }
          const derivedResult = computeDerivedFieldFacts({
            cases: derivedField.cases.map((caseRecord) => ({
              condition:
                caseRecord.condition.kind === "otherwise"
                  ? { kind: "otherwise" as const }
                  : caseRecord.condition,
              result: caseRecord.result,
              sourceOrigin: caseRecord.sourceOrigin,
            })),
            source: derivedField.source,
            fieldId: derivedField.field.fieldId,
            name: derivedField.field.name,
            type: resolvedType,
            unit: "scalarValue",
            target: input.target,
            targetFacts: state.targetFacts,
            instanceId: buffer.instanceId,
            program: input.program,
            layoutFieldWireByFieldId: layoutFieldWireByFieldIdFromBuffer(buffer),
            typeResolver: state.resolver,
            sourceOrigin: derivedField.field.sourceOrigin,
            derivedFieldRangeByFieldId,
            dependencyContext: {
              parameterFieldIds,
              availableLayoutFieldIds,
              availableDerivedFieldIds: derivedFieldIdsBefore(buffer, derivedField.field.fieldId),
            },
          });
          recordBuilderResult(context, derivedResult, String(input.target.targetId));
          if (derivedResult.kind === "ok") {
            derivedFields.push(derivedResult.value.fact);
            derivedFieldRangeByFieldId.set(
              derivedField.field.fieldId,
              derivedResult.value.resultRange,
            );
          }
        }

        bufferFacts.push({
          instanceId: buffer.instanceId,
          typeKey: { kind: "source", instanceId: buffer.instanceId },
          valueStorage: valueStorageResult.value.valueStorage,
          sourceLengthTerm: fieldFactsResult.value.sourceLengthTerm,
          layoutFields: fieldFactsResult.value.layoutFields,
          derivedFields,
          ...(fieldFactsResult.value.fixedEndBytes !== undefined
            ? { fixedEndBytes: fieldFactsResult.value.fixedEndBytes }
            : {}),
          sourceOrigin: buffer.sourceOrigin,
        });
      }

      if (validatedBufferTypeFacts.length > 0) {
        state.types = mergeTypeFacts(state.types, validatedBufferTypeFacts);
      }
      if (parameterFieldFacts.length > 0) {
        state.fields = [...(state.fields ?? []), ...parameterFieldFacts];
      }
      state.validatedBuffers = bufferFacts;
    },

    runAbiFacts(): void {
      if (state.targetFacts === undefined || state.types === undefined) {
        return;
      }

      const enumTable = layoutDeterministicTable({
        entries: state.enums ?? [],
        keyOf: (entry) => entry.owner,
        keyString: layoutEnumKeyString,
      });

      let resolver: LayoutTypeResolver | undefined = state.resolver;
      if (resolver === undefined) {
        const resolverResult = buildLayoutTypeResolver({
          program: input.program,
          targetFacts: state.targetFacts,
          primitiveTypes: state.types,
        });
        if (resolverResult.kind === "ok") {
          resolver = resolverResult.value.resolver;
        }
      }
      if (resolver === undefined) {
        return;
      }

      const functionAbiResult = computeSourceFunctionAbiFacts({
        program: input.program,
        target: input.target,
        targetFacts: state.targetFacts,
        types: state.types,
        enums: enumTable,
        resolver,
      });
      recordBuilderResult(context, functionAbiResult, String(input.target.targetId));
      if (functionAbiResult.kind === "ok") {
        state.functions = functionAbiResult.value.functions;
      }

      state.sourceFunctionAbiFailures = collectSourceFunctionAbiFailures(
        input.program,
        context.issues(),
      );

      const platformAbiResult = computePlatformAbiFacts({
        program: input.program,
        target: input.target,
        targetFacts: state.targetFacts,
        types: state.types,
        enums: enumTable,
        resolver,
        sourceFunctionAbiFailures: state.sourceFunctionAbiFailures,
      });
      recordBuilderResult(context, platformAbiResult, String(input.target.targetId));
      if (platformAbiResult.kind === "ok") {
        state.platformEdges = platformAbiResult.value.platformEdges;
      }

      const imageEntryResult = computeImageEntryAbiFact({
        program: input.program,
        target: input.target,
        targetFacts: state.targetFacts,
        types: state.types,
        enums: enumTable,
        resolver,
      });
      recordBuilderResult(context, imageEntryResult, String(input.target.targetId));
      if (imageEntryResult.kind === "ok") {
        state.imageEntry = imageEntryResult.value.fact;
      }
    },

    runConsistencyChecks(): void {
      runLayoutFactConsistencyChecks(state, context);
    },

    finish(): ComputeRepresentationLayoutFactsResult {
      const diagnostics = finalizeLayoutDiagnostics({
        issues: context.issues(),
        diagnostics: context.diagnostics(),
      });
      const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");

      if (
        hasErrors ||
        state.targetFacts === undefined ||
        state.types === undefined ||
        state.imageEntry === undefined
      ) {
        return { kind: "error", diagnostics };
      }

      const facts: LayoutFactProgram = {
        target: state.targetFacts,
        types: state.types,
        fields: layoutDeterministicTable({
          entries: state.fields ?? [],
          keyOf: (entry) => ({ owner: entry.owner, fieldId: entry.fieldId }),
          keyString: layoutFieldKeyString,
        }),
        enums: layoutDeterministicTable({
          entries: state.enums ?? [],
          keyOf: (entry) => entry.owner,
          keyString: layoutEnumKeyString,
        }),
        validatedBuffers:
          state.validatedBuffers === undefined || state.validatedBuffers.length === 0
            ? emptyValidatedBufferTable()
            : layoutDeterministicTable({
                entries: state.validatedBuffers,
                keyOf: (entry) => entry.instanceId,
                keyString: layoutValidatedBufferKeyString,
              }),
        imageDevices: state.imageDevices ?? emptyImageDeviceTable(),
        functions: state.functions ?? emptyFunctionAbiTable(),
        platformEdges: state.platformEdges ?? emptyPlatformAbiTable(),
        imageEntry: state.imageEntry,
      };

      return { kind: "ok", facts, diagnostics };
    },
  };
}

export function computeRepresentationLayoutFacts(
  input: ComputeRepresentationLayoutFactsInput,
): ComputeRepresentationLayoutFactsResult {
  const builder = createLayoutFactBuilderContext(input);
  builder.runTargetValidation();
  builder.runTypeResolution();
  builder.runSourceRepresentations();
  builder.runValidatedBuffers();
  builder.runAbiFacts();
  builder.runConsistencyChecks();
  return builder.finish();
}
