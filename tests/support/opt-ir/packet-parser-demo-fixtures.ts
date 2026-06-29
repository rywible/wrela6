import type { LayoutFactKey } from "../../../src/proof-check/model/fact-packet";
import {
  optIrCallId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { OptIrDiagnostic } from "../../../src/opt-ir/diagnostics";
import {
  type BuildOptimizedOptIrInput,
  type BuildOptimizedOptIrDependencies,
} from "../../../src/opt-ir/public-api";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import {
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrLayoutEndianDecodeOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
} from "../../../src/opt-ir/operations";
import { optimizeOptIr, type OptimizeOptIrResult } from "../../../src/opt-ir/passes/pipeline";
import { rewriteLegalityObligationId } from "../../../src/opt-ir/passes/pass-contract";
import {
  runWrelaBoundsZeroCopyForTest,
  runWrelaEndianParserCollapseForTest,
  runWrelaMoveCopyWrapperElisionForTest,
} from "../../../src/opt-ir/passes/wrela-optimizations";
import type {
  WrelaBoundsZeroCopyResult,
  WrelaEndianParserResult,
  WrelaMoveCopyWrapperElisionResult,
} from "../../../src/opt-ir/passes/wrela-optimizations";
import { productionOptimizationPolicyForTest } from "../../../src/opt-ir/policy/optimization-profile";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { validConstructOptIrInputForTest } from "./construction-fixtures";
import { targetOptimizationSurfaceForTest } from "./target-optimization-fakes";

export interface PacketParserDemoSnapshot {
  readonly operations: readonly OptIrOperation[];
  readonly bounds: WrelaBoundsZeroCopyResult;
  readonly endianParser: WrelaEndianParserResult;
  readonly moveCopyWrapper: WrelaMoveCopyWrapperElisionResult;
  readonly diagnostics: readonly OptIrDiagnostic[];
}

const ORIGIN = optIrOriginId(700);
const DIAGNOSTIC_REJECTION_ORIGIN = optIrOriginId(701);
const COLD_REJECTION_ORIGIN = optIrOriginId(702);
const PACKET_REGION = optIrRegionId(70);
const HEADER_LAYOUT = "layout:packet:header.kind" as LayoutFactKey;
const LENGTH_LAYOUT = "layout:packet:header.length" as LayoutFactKey;

export function packetParserDemoInputForTest(): BuildOptimizedOptIrInput {
  return {
    ...validConstructOptIrInputForTest(),
    target: targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    policy: productionOptimizationPolicyForTest(),
  };
}

export function packetParserDemoOptimizerForTest(): BuildOptimizedOptIrDependencies["optimizer"] {
  return (input): OptimizeOptIrResult => {
    const base = optimizeOptIr({
      ...input,
      program: {
        ...input.program,
        operations: packetParserDemoOperationsForTest(),
      },
    });
    if (base.kind === "error") {
      return base;
    }
    const snapshot = optimizedPacketParserDemoSnapshotForTest();
    return {
      ...base,
      operations: snapshot.operations,
      diagnostics: [...base.diagnostics, ...snapshot.diagnostics],
    };
  };
}

export function optimizedPacketParserDemoSnapshotForTest(): PacketParserDemoSnapshot {
  const operations = packetParserDemoOperationsForTest();
  const bounds = runWrelaBoundsZeroCopyForTest({
    operations,
    candidates: [
      {
        checkOperationId: optIrOperationId(710),
        affectedAccessOperationIds: [optIrOperationId(720), optIrOperationId(721)],
        licensingFactId: optIrFactId(710),
        obligationId: rewriteLegalityObligationId("packet-demo:bounds"),
        factChain: [
          "validated-buffer:packet:attested",
          "layout:packet:header",
          "path:packet:accepted",
        ],
      },
    ],
    zeroCopyAccessOperationIds: [optIrOperationId(720), optIrOperationId(721)],
  });
  const endianParser = runWrelaEndianParserCollapseForTest({
    operations: bounds.operations,
    endianFoldCandidates: [
      {
        operationId: optIrOperationId(722),
        endian: "big",
        regionKind: "normal",
        volatility: "nonVolatile",
        factChain: ["layout:endian:network", "target:bswap32"],
      },
    ],
    parserCollapseCandidates: [
      {
        parserStateOperationIds: [optIrOperationId(711), optIrOperationId(712)],
        directLoadOperationIds: [optIrOperationId(720), optIrOperationId(721)],
        coldRejectionOrigins: [COLD_REJECTION_ORIGIN],
        diagnosticOrigins: [DIAGNOSTIC_REJECTION_ORIGIN],
        factChain: ["path:packet:accepted", "terminal:cold-reject-unobservable"],
      },
    ],
  });
  const moveCopyWrapper = runWrelaMoveCopyWrapperElisionForTest({
    operations: endianParser.operations,
    candidates: [
      wrapperCandidate(optIrOperationId(713), optIrValueId(730), optIrValueId(731), "wrapper"),
      wrapperCandidate(optIrOperationId(714), optIrValueId(732), optIrValueId(733), "copy"),
      wrapperCandidate(optIrOperationId(715), optIrValueId(734), optIrValueId(735), "wrapper"),
      wrapperCandidate(optIrOperationId(716), optIrValueId(736), optIrValueId(737), "move"),
    ],
  });

  return {
    operations: moveCopyWrapper.operations,
    bounds,
    endianParser,
    moveCopyWrapper,
    diagnostics: explanationDiagnostics(bounds, endianParser, moveCopyWrapper),
  };
}

export function hasNoProofOrValidationWrappersForTest(
  operations: readonly OptIrOperation[],
): boolean {
  return operations.every(
    (operation) =>
      operation.displayName !== "proof-wrapper" &&
      operation.displayName !== "validation-wrapper" &&
      operation.displayName !== "resource-wrapper" &&
      operation.displayName !== "safe-field-api-thunk" &&
      operation.displayName !== "parser-state",
  );
}

export function canonicalPacketLoadsForTest(
  operations: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  return operations.filter(
    (operation) =>
      operation.kind === "memoryLoad" &&
      operation.memoryAccess.region === PACKET_REGION &&
      operation.memoryAccess.boundsAuthority.kind === "validatedBuffer" &&
      operation.memoryAccess.layoutPath !== undefined &&
      operation.memoryAccess.endian !== "native" &&
      operation.memoryAccess.volatility === "nonVolatile",
  );
}

export function derivedFieldOperationKindsForTest(
  operations: readonly OptIrOperation[],
): readonly string[] {
  return operations
    .filter((operation) =>
      ["memoryLoad", "layoutEndianDecode", "integerBinary", "integerCompare"].includes(
        operation.kind,
      ),
    )
    .map((operation) => operation.kind);
}

function packetParserDemoOperationsForTest(): readonly OptIrOperation[] {
  return [
    runtimeCall(710, "runtime.bounds_check", "validation-wrapper"),
    runtimeCall(711, "runtime.packet_parser_state", "parser-state"),
    runtimeCall(712, "runtime.packet_parser_state.advance", "parser-state"),
    runtimeCall(713, "runtime.proof_wrapper", "proof-wrapper"),
    runtimeCall(714, "runtime.copy", "validation-wrapper"),
    runtimeCall(715, "runtime.resource_wrapper", "resource-wrapper"),
    runtimeCall(716, "runtime.safe_field_api", "safe-field-api-thunk"),
    packetLoad(720, 740, 0n, 2, "big", HEADER_LAYOUT),
    packetLoad(721, 741, 2n, 2, "big", LENGTH_LAYOUT),
    optIrLayoutEndianDecodeOperation({
      operationId: optIrOperationId(722),
      bytes: optIrValueId(740),
      endian: "big",
      resultId: optIrValueId(742),
      resultType: optIrUnsignedIntegerType(16),
      originId: ORIGIN,
    }),
    optIrIntegerBinaryOperation({
      operationId: optIrOperationId(723),
      left: optIrValueId(742),
      right: optIrValueId(741),
      operator: "and",
      resultId: optIrValueId(743),
      resultType: optIrUnsignedIntegerType(16),
      originId: ORIGIN,
    }),
    optIrIntegerCompareOperation({
      operationId: optIrOperationId(724),
      left: optIrValueId(743),
      right: optIrValueId(741),
      operator: "equal",
      resultId: optIrValueId(744),
      originId: ORIGIN,
    }),
    runtimeCall(725, "runtime.packet_parser_reject_diagnostic", "observable-reject"),
  ];
}

function packetLoad(
  operation: number,
  result: number,
  byteOffset: bigint,
  byteWidth: number,
  endian: "big" | "little",
  layoutPath: LayoutFactKey,
): OptIrOperation {
  const result_ = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    region: PACKET_REGION,
    byteOffset,
    byteWidth,
    alignment: byteWidth,
    valueType: optIrUnsignedIntegerType(byteWidth * 8),
    endian,
    volatility: "nonVolatile",
    layoutPath,
    boundsAuthority: { kind: "targetContract", authorityKey: "pre-validated" },
    originId: ORIGIN,
  });
  if (result_.kind === "error") {
    throw new Error("packet parser demo load fixture must be valid");
  }
  return result_.operation;
}

function runtimeCall(operation: number, runtimeKey: string, displayName: string): OptIrOperation {
  const call = optIrRuntimeCallOperation({
    operationId: optIrOperationId(operation),
    callId: optIrCallId(operation),
    target: { kind: "runtime", runtimeKey },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: ORIGIN,
  });
  return { ...call, displayName };
}

function wrapperCandidate(
  operationId: ReturnType<typeof optIrOperationId>,
  sourceValue: ReturnType<typeof optIrValueId>,
  resultValue: ReturnType<typeof optIrValueId>,
  kind: "copy" | "move" | "wrapper",
) {
  return {
    operationId,
    sourceValue,
    resultValue,
    kind,
    ownershipFactIds: [`ownership:${operationId}`],
    noaliasFactIds: [`noalias:${operationId}`],
    erasureFactIds: [`erasure:${operationId}`],
    hasObservableCleanup: false,
  };
}

function explanationDiagnostics(
  bounds: WrelaBoundsZeroCopyResult,
  endianParser: WrelaEndianParserResult,
  moveCopyWrapper: WrelaMoveCopyWrapperElisionResult,
): readonly OptIrDiagnostic[] {
  const records = [
    ...bounds.explanations.map((explanation) => ({
      ownerKey: `operation:${explanation.operationId}`,
      rootCauseKey: explanation.kind,
      message:
        explanation.kind === "boundsCheckEliminated" ? "removed bounds check" : "zero copy access",
      facts: explanation.factChain,
    })),
    ...endianParser.explanations.map((explanation) => ({
      ownerKey: `operation:${explanation.operationId ?? "parser-state"}`,
      rootCauseKey: explanation.kind,
      message:
        explanation.kind === "endianFolded" ? "folded endian decode" : "removed parser state",
      facts: explanation.factChain,
    })),
    ...moveCopyWrapper.explanations.map((explanation) => ({
      ownerKey: `operation:${explanation.operationId}`,
      rootCauseKey: explanation.kind,
      message: explanation.kind === "copyEliminated" ? "removed copy helper" : "removed wrapper",
      facts: explanation.factChain,
    })),
  ];

  return records.map((record, index) => ({
    severity: "info",
    code: "OPT_IR_INPUT_CONTRACT_INVALID" as never,
    messageTemplate: record.message,
    arguments: {},
    ownerKey: record.ownerKey,
    rootCauseKey: record.rootCauseKey,
    stableDetail: `provenance:packet-parser-demo:${index};facts:${record.facts.join(">")}`,
    orderKey: `packet-parser-demo:${String(index).padStart(2, "0")}` as never,
  }));
}
