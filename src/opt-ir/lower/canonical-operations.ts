import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import {
  optIrConstantPool,
  type OptIrConstant,
  type OptIrTargetDataModelInterpretation,
} from "../constants";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import {
  optIrConstantId,
  optIrOperationId,
  type OptIrEdgeId,
  type OptIrOperationId,
  type OptIrOriginId,
  type OptIrValueId,
} from "../ids";
import {
  optIrAggregateExtractOperation,
  optIrAggregateInsertOperation,
  optIrConstantOperation,
  optIrEnumPayloadStoreOperation,
  optIrEnumTagLoadOperation,
  optIrEnumTagStoreOperation,
  optIrLayoutOffsetOperation,
  type OptIrOperation,
} from "../operations";
import {
  optIrBranchTerminator,
  optIrSwitchTerminator,
  type OptIrBranchTerminator,
  type OptIrSwitchTerminator,
  type OptIrUnreachableTerminator,
} from "../terminators";
import { optIrBooleanType, optIrTypeStableKey, optIrTypesEqual, type OptIrType } from "../types";

export type CanonicalOperationInputForTest =
  | CanonicalConstantInput
  | CanonicalFieldProjectionInput
  | CanonicalFieldInsertInput
  | CanonicalEnumConstructInput
  | CanonicalEnumMatchInput
  | CanonicalBranchInput
  | CanonicalTerminalExitInput
  | CanonicalUnsupportedInput;

export interface CanonicalLoweringInputForTest {
  readonly dataModel?: OptIrTargetDataModelInterpretation;
  readonly operations: readonly CanonicalOperationInputForTest[];
}

export type CanonicalLoweringResultForTest =
  | {
      readonly kind: "ok";
      readonly operations: readonly OptIrOperation[];
      readonly terminators: readonly CanonicalTerminatorForTest[];
      readonly constants: readonly OptIrConstant[];
      readonly layoutPaths: readonly CanonicalLayoutPathForTest[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface CanonicalConstantInput {
  readonly kind: "constant";
  readonly output: OptIrValueId;
  readonly type: OptIrType;
  readonly value: bigint | number | string | boolean;
  readonly originId: OptIrOriginId;
}

export interface CanonicalFieldProjectionInput {
  readonly kind: "fieldProjection";
  readonly aggregate: OptIrValueId;
  readonly output: OptIrValueId;
  readonly resultType: OptIrType;
  readonly fieldPath: readonly string[];
  readonly layoutPath: LayoutFactKey;
  readonly byteOffset: bigint | number | string;
  readonly originId: OptIrOriginId;
}

export interface CanonicalFieldInsertInput {
  readonly kind: "fieldInsert";
  readonly aggregate: OptIrValueId;
  readonly field: OptIrValueId;
  readonly output: OptIrValueId;
  readonly resultType: OptIrType;
  readonly fieldPath: readonly string[];
  readonly originId: OptIrOriginId;
}

export interface CanonicalEnumConstructInput {
  readonly kind: "enumConstruct";
  readonly output: OptIrValueId;
  readonly enumType: OptIrType;
  readonly tagType: OptIrType;
  readonly tagValue: bigint | number | string | boolean;
  readonly payloads: readonly OptIrValueId[];
  readonly enumTypeKey?: string;
  readonly caseName?: string;
  readonly caseOrdinal?: number;
  readonly payloadFieldNames?: readonly string[];
  readonly originId: OptIrOriginId;
}

export interface CanonicalEnumMatchInput {
  readonly kind: "enumMatch";
  readonly enumValue: OptIrValueId;
  readonly tagOutput: OptIrValueId;
  readonly tagType: OptIrType;
  readonly enumType?: OptIrType;
  readonly enumTypeKey?: string;
  readonly caseName?: string;
  readonly caseOrdinal?: number;
  readonly cases: readonly { readonly label: string; readonly edge: OptIrEdgeId }[];
  readonly defaultEdge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}

export interface CanonicalBranchInput {
  readonly kind: "branch";
  readonly condition: OptIrValueId;
  readonly conditionType: OptIrType;
  readonly trueEdge: OptIrEdgeId;
  readonly falseEdge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}

export type CanonicalTerminalExitInput =
  | {
      readonly kind: "terminalExit";
      readonly terminalKind: "terminalCall";
      readonly target: string;
      readonly arguments: readonly OptIrValueId[];
      readonly originId: OptIrOriginId;
    }
  | {
      readonly kind: "terminalExit";
      readonly terminalKind: "trap" | "panic";
      readonly reason: string;
      readonly originId: OptIrOriginId;
    }
  | {
      readonly kind: "terminalExit";
      readonly terminalKind: "unreachable";
      readonly originId: OptIrOriginId;
    };

export interface CanonicalUnsupportedInput {
  readonly kind: "unsupported";
  readonly operationName: string;
  readonly reachable: boolean;
  readonly originId: OptIrOriginId;
}

export interface CanonicalLayoutPathForTest {
  readonly fieldPath: readonly string[];
  readonly layoutPath: LayoutFactKey;
  readonly byteOffset: bigint;
}

export type CanonicalTerminatorForTest =
  | OptIrBranchTerminator
  | OptIrSwitchTerminator
  | OptIrUnreachableTerminator
  | CanonicalTerminalCallTerminatorForTest
  | CanonicalTrapTerminatorForTest
  | CanonicalPanicTerminatorForTest;

export interface CanonicalTerminalCallTerminatorForTest {
  readonly kind: "terminalCall";
  readonly operationId: OptIrOperationId;
  readonly target: string;
  readonly arguments: readonly OptIrValueId[];
  readonly originId: OptIrOriginId;
}

export interface CanonicalTrapTerminatorForTest {
  readonly kind: "trap";
  readonly operationId: OptIrOperationId;
  readonly reason: string;
  readonly originId: OptIrOriginId;
}

export interface CanonicalPanicTerminatorForTest {
  readonly kind: "panic";
  readonly operationId: OptIrOperationId;
  readonly reason: string;
  readonly originId: OptIrOriginId;
}

export function lowerCanonicalOperationsForTest(
  input: CanonicalLoweringInputForTest,
): CanonicalLoweringResultForTest {
  const context = canonicalLoweringContext(input.dataModel);

  for (const operation of input.operations) {
    if (operation.kind === "unsupported") {
      if (operation.reachable) {
        context.reportUnsupported(operation);
      }
      continue;
    }
    context.lower(operation);
  }

  const diagnostics = context.diagnostics();
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  return {
    kind: "ok",
    operations: context.operations(),
    terminators: context.terminators(),
    constants: context.constants(),
    layoutPaths: context.layoutPaths(),
  };
}

function canonicalLoweringContext(dataModel: OptIrTargetDataModelInterpretation | undefined) {
  const constantPool = optIrConstantPool();
  const operations: OptIrOperation[] = [];
  const terminators: CanonicalTerminatorForTest[] = [];
  const layoutPaths: CanonicalLayoutPathForTest[] = [];
  const diagnostics: OptIrDiagnostic[] = [];
  let nextOperationId = 0;
  let nextConstantId = 0;
  let nextSyntheticValueId = 10_000_000;

  function operationId(): OptIrOperationId {
    return optIrOperationId(nextOperationId++);
  }

  function syntheticValueId(): OptIrValueId {
    return nextSyntheticValueId++ as OptIrValueId;
  }

  function internConstant(input: {
    readonly type: OptIrType;
    readonly value: bigint | number | string | boolean;
  }) {
    return constantPool.internInteger({
      constantId: optIrConstantId(nextConstantId++),
      type: input.type,
      normalizedValue: normalizeConstantValue(input.value),
      dataModel,
    });
  }

  function emitConstant(input: {
    readonly output: OptIrValueId;
    readonly type: OptIrType;
    readonly value: bigint | number | string | boolean;
    readonly originId: OptIrOriginId;
  }): void {
    operations.push(
      optIrConstantOperation({
        operationId: operationId(),
        resultId: input.output,
        constant: internConstant(input),
        originId: input.originId,
      }),
    );
  }

  return {
    lower(operation: Exclude<CanonicalOperationInputForTest, CanonicalUnsupportedInput>) {
      switch (operation.kind) {
        case "constant":
          emitConstant(operation);
          return;
        case "fieldProjection": {
          const offsetValue = syntheticValueId();
          const byteOffset = normalizeConstantValue(operation.byteOffset);
          layoutPaths.push(
            Object.freeze({
              fieldPath: Object.freeze([...operation.fieldPath]),
              layoutPath: operation.layoutPath,
              byteOffset,
            }),
          );
          operations.push(
            optIrLayoutOffsetOperation({
              operationId: operationId(),
              base: operation.aggregate,
              layoutPath: operation.layoutPath,
              resultId: offsetValue,
              resultType: operation.resultType,
              originId: operation.originId,
            }),
          );
          operations.push(
            optIrAggregateExtractOperation({
              operationId: operationId(),
              aggregate: operation.aggregate,
              fieldPath: Object.freeze([...operation.fieldPath]),
              resultId: operation.output,
              resultType: operation.resultType,
              originId: operation.originId,
            }),
          );
          return;
        }
        case "fieldInsert":
          operations.push(
            optIrAggregateInsertOperation({
              operationId: operationId(),
              aggregate: operation.aggregate,
              field: operation.field,
              fieldPath: Object.freeze([...operation.fieldPath]),
              resultId: operation.output,
              resultType: operation.resultType,
              originId: operation.originId,
            }),
          );
          return;
        case "enumConstruct": {
          const tagValue = syntheticValueId();
          const enumCase = canonicalEnumCaseDescriptor(operation);
          emitConstant({
            output: tagValue,
            type: operation.tagType,
            value: operation.tagValue,
            originId: operation.originId,
          });
          const tagResult = operation.payloads.length === 0 ? operation.output : syntheticValueId();
          operations.push(
            optIrEnumTagStoreOperation({
              operationId: operationId(),
              tagValue,
              enumCase,
              resultId: tagResult,
              resultType: operation.enumType,
              originId: operation.originId,
            }),
          );
          let currentEnumValue = tagResult;
          for (const [index, payload] of operation.payloads.entries()) {
            const resultId =
              index === operation.payloads.length - 1 ? operation.output : syntheticValueId();
            operations.push(
              optIrEnumPayloadStoreOperation({
                operationId: operationId(),
                enumValue: currentEnumValue,
                payloadValue: payload,
                enumCase: {
                  ...enumCase,
                  payloadFieldName: operation.payloadFieldNames?.[index] ?? `payload${index}`,
                },
                resultId,
                resultType: operation.enumType,
                originId: operation.originId,
              }),
            );
            currentEnumValue = resultId;
          }
          return;
        }
        case "enumMatch":
          operations.push(
            optIrEnumTagLoadOperation({
              operationId: operationId(),
              enumValue: operation.enumValue,
              enumCase: canonicalEnumMatchDescriptor(operation),
              resultId: operation.tagOutput,
              resultType: operation.tagType,
              originId: operation.originId,
            }),
          );
          terminators.push(
            optIrSwitchTerminator({
              operationId: operationId(),
              scrutinee: operation.tagOutput,
              cases: Object.freeze(
                operation.cases.map((switchCase) => Object.freeze({ ...switchCase })),
              ),
              defaultEdge: operation.defaultEdge,
              originId: operation.originId,
            }),
          );
          return;
        case "branch":
          if (!optIrTypesEqual(operation.conditionType, optIrBooleanType())) {
            diagnostics.push(
              unsupportedDiagnostic("non-boolean-branch-condition", operation.originId),
            );
            return;
          }
          terminators.push(
            optIrBranchTerminator({
              operationId: operationId(),
              condition: operation.condition,
              trueEdge: operation.trueEdge,
              falseEdge: operation.falseEdge,
              originId: operation.originId,
            }),
          );
          return;
        case "terminalExit":
          terminators.push(lowerTerminalExit(operation, operationId()));
          return;
      }
    },
    reportUnsupported(operation: CanonicalUnsupportedInput) {
      diagnostics.push(unsupportedDiagnostic(operation.operationName, operation.originId));
    },
    operations() {
      return Object.freeze([...operations]);
    },
    terminators() {
      return Object.freeze([...terminators]);
    },
    constants() {
      return constantPool.constants();
    },
    layoutPaths() {
      return Object.freeze([...layoutPaths]);
    },
    diagnostics() {
      return sortOptIrDiagnostics(diagnostics);
    },
  };
}

function canonicalEnumCaseDescriptor(operation: CanonicalEnumConstructInput) {
  const caseOrdinal = operation.caseOrdinal ?? Number(normalizeConstantValue(operation.tagValue));
  return Object.freeze({
    enumTypeKey: operation.enumTypeKey ?? optIrTypeStableKey(operation.enumType),
    caseName: operation.caseName ?? `case${caseOrdinal}`,
    caseOrdinal,
    tagValue: String(normalizeConstantValue(operation.tagValue)),
  });
}

function canonicalEnumMatchDescriptor(operation: CanonicalEnumMatchInput) {
  const firstCaseLabel = operation.cases[0]?.label ?? String(operation.caseOrdinal ?? 0);
  const caseOrdinal = operation.caseOrdinal ?? Number(firstCaseLabel);
  return Object.freeze({
    enumTypeKey:
      operation.enumTypeKey ??
      (operation.enumType === undefined ? "enum:unknown" : optIrTypeStableKey(operation.enumType)),
    caseName: operation.caseName ?? `case${Number.isFinite(caseOrdinal) ? caseOrdinal : 0}`,
    caseOrdinal: Number.isFinite(caseOrdinal) ? caseOrdinal : 0,
    tagValue: firstCaseLabel,
  });
}

function lowerTerminalExit(
  input: CanonicalTerminalExitInput,
  operationId: OptIrOperationId,
): CanonicalTerminatorForTest {
  switch (input.terminalKind) {
    case "terminalCall":
      return Object.freeze({
        kind: "terminalCall",
        operationId,
        target: input.target,
        arguments: Object.freeze([...input.arguments]),
        originId: input.originId,
      });
    case "trap":
      return Object.freeze({
        kind: "trap",
        operationId,
        reason: input.reason,
        originId: input.originId,
      });
    case "panic":
      return Object.freeze({
        kind: "panic",
        operationId,
        reason: input.reason,
        originId: input.originId,
      });
    case "unreachable":
      return Object.freeze({ kind: "unreachable", operationId, originId: input.originId });
  }
}

function normalizeConstantValue(value: bigint | number | string | boolean): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1n : 0n;
  }
  return BigInt(value);
}

function unsupportedDiagnostic(operationName: string, originId: OptIrOriginId): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION");
  const ownerKey = `checked-mir-operation:${operationName}`;
  const rootCauseKey = "checked-mir-operation";
  const stableDetail = `unsupported:${operationName}`;
  return {
    severity: "error",
    code,
    messageTemplate:
      "Checked MIR operation {operationName} is not supported by OptIR construction.",
    arguments: { operationName },
    ownerKey,
    rootCauseKey,
    stableDetail,
    originId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(originId),
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}
