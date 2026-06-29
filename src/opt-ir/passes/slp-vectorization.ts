import { optIrOriginId, optIrOperationId, optIrRegionId, optIrValueId } from "../ids";
import {
  optIrVectorByteSwapOperation,
  optIrVectorCompareOperation,
  optIrVectorLoadOperation,
  optIrVectorStoreOperation,
  type OptIrEndian,
  type OptIrOperation,
} from "../operations";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrVectorPolicy } from "../policy/vector-policy";
import {
  optIrVectorPolicyAllowsLaneCount,
  optIrVectorPolicyAllowsLaneType,
} from "../policy/vector-policy";
import { optIrVectorType, vectorMaskType } from "../vector-types";
import { optIrUnitType, type OptIrScalarType } from "../types";

export type OptIrSlpIdiom =
  | "adjacentPacketFieldRead"
  | "adjacentSourceFieldRead"
  | "endianDecode"
  | "validationComparison"
  | "fixedWidthCopy"
  | "fixedWidthSet"
  | "parserTableCheck";

export type OptIrSlpRejectionReason =
  | "missingLaneBounds"
  | "aliasUnsafe"
  | "effectUnsafe"
  | "endianIllegal"
  | "targetFeatureMissing"
  | "unalignedAccessRejected"
  | "registerPressureTooHigh"
  | "missingSourceValues";

export interface OptIrSlpCandidate {
  readonly idiom: OptIrSlpIdiom;
  readonly laneType: OptIrScalarType;
  readonly lanes: number;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly alignment: number;
  readonly laneBoundsProven: boolean;
  readonly aliasSafe: boolean;
  readonly effectSafe: boolean;
  readonly endianLegal: boolean;
  readonly targetFeatureLegal: boolean;
  readonly unalignedAccess: boolean;
  readonly estimatedLiveVectorRegisters: number;
  readonly sourceValueIds: readonly OptIrValueId[];
  readonly endian?: OptIrEndian;
}

export interface RunSlpVectorizationInput {
  readonly blockId: OptIrBlockId;
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly nextOperationId: number;
  readonly nextValueId: number;
  readonly candidates: readonly OptIrSlpCandidate[];
  readonly policy: OptIrVectorPolicy;
}

export interface OptIrSlpRewriteRecord {
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly vectorOperationId: OptIrOperationId;
  readonly invariant: { readonly kind: "vectorLaneEquivalence" };
}

export interface OptIrSlpRejection {
  readonly candidate: OptIrSlpCandidate;
  readonly reason: OptIrSlpRejectionReason;
}

export interface RunSlpVectorizationResult {
  readonly vectorOperations: readonly OptIrOperation[];
  readonly rewriteRecords: readonly OptIrSlpRewriteRecord[];
  readonly rejections: readonly OptIrSlpRejection[];
}

export function runSlpVectorization(input: RunSlpVectorizationInput): RunSlpVectorizationResult {
  const vectorOperations: OptIrOperation[] = [];
  const rewriteRecords: OptIrSlpRewriteRecord[] = [];
  const rejections: OptIrSlpRejection[] = [];
  let nextOperationId = input.nextOperationId;
  let nextValueId = input.nextValueId;

  for (const candidate of input.candidates) {
    const rejection = vectorLegalityRejection(candidate, input.policy);
    if (rejection !== undefined) {
      rejections.push({ candidate, reason: rejection });
      continue;
    }

    const operationId = optIrOperationId(nextOperationId);
    nextOperationId += 1;
    const resultId = optIrValueId(nextValueId);
    nextValueId += 1;
    const operation = vectorOperationForCandidate(candidate, operationId, resultId);
    vectorOperations.push(operation);
    rewriteRecords.push({
      scalarOperationIds: Object.freeze([...input.scalarOperationIds]),
      vectorOperationId: operation.operationId,
      invariant: { kind: "vectorLaneEquivalence" },
    });
  }

  return {
    vectorOperations: Object.freeze(vectorOperations),
    rewriteRecords: Object.freeze(rewriteRecords),
    rejections: Object.freeze(rejections),
  };
}

function vectorLegalityRejection(
  candidate: OptIrSlpCandidate,
  policy: OptIrVectorPolicy,
): OptIrSlpRejectionReason | undefined {
  if (!candidate.laneBoundsProven) return "missingLaneBounds";
  if (!candidate.aliasSafe) return "aliasUnsafe";
  if (!candidate.effectSafe) return "effectUnsafe";
  if (!candidate.endianLegal) return "endianIllegal";
  if (
    !policy.enabled ||
    !candidate.targetFeatureLegal ||
    !optIrVectorPolicyAllowsLaneType(policy, candidate.laneType) ||
    !optIrVectorPolicyAllowsLaneCount(policy, candidate.lanes)
  ) {
    return "targetFeatureMissing";
  }
  if (candidate.unalignedAccess && !policy.allowUnalignedPacketLoads) {
    return "unalignedAccessRejected";
  }
  if (candidate.estimatedLiveVectorRegisters > policy.maxLiveVectorRegisters) {
    return "registerPressureTooHigh";
  }
  if (requiredSourceValueCount(candidate) > candidate.sourceValueIds.length) {
    return "missingSourceValues";
  }
  return undefined;
}

function vectorOperationForCandidate(
  candidate: OptIrSlpCandidate,
  operationId: OptIrOperationId,
  resultId: OptIrValueId,
): OptIrOperation {
  switch (candidate.idiom) {
    case "endianDecode":
      return optIrVectorByteSwapOperation({
        operationId,
        vector: firstSource(candidate),
        endian: candidate.endian ?? "big",
        resultId,
        resultType: optIrVectorType(candidate.laneType, candidate.lanes),
        originId: optIrOriginId(0),
      });
    case "validationComparison":
    case "parserTableCheck":
      return optIrVectorCompareOperation({
        operationId,
        sourceValueIds: candidate.sourceValueIds,
        resultId,
        resultType: vectorMaskType(candidate.lanes),
        originId: optIrOriginId(0),
      });
    case "fixedWidthSet":
      return requireConstructedOperation(
        optIrVectorStoreOperation({
          operationId,
          vector: requireSource(candidate, 0),
          storeValue: requireSource(candidate, 1),
          region: optIrRegionId(0),
          byteOffset: candidate.byteOffset,
          byteWidth: candidate.byteWidth,
          alignment: candidate.alignment,
          valueType: optIrUnitType(),
          endian: "native",
          volatility: "nonVolatile",
          boundsAuthority: { kind: "targetContract", authorityKey: "slp-fixed-width-set" },
          originId: optIrOriginId(0),
        }),
      );
    case "adjacentPacketFieldRead":
    case "adjacentSourceFieldRead":
    case "fixedWidthCopy":
      return requireConstructedOperation(
        optIrVectorLoadOperation({
          operationId,
          resultId,
          resultType: optIrVectorType(candidate.laneType, candidate.lanes),
          region: optIrRegionId(0),
          byteOffset: candidate.byteOffset,
          byteWidth: candidate.byteWidth,
          alignment: candidate.alignment,
          valueType: optIrVectorType(candidate.laneType, candidate.lanes),
          endian: "native",
          volatility: "nonVolatile",
          boundsAuthority: { kind: "targetContract", authorityKey: "slp-vector-load" },
          originId: optIrOriginId(0),
        }),
      );
  }
}

function firstSource(candidate: OptIrSlpCandidate): OptIrValueId {
  return requireSource(candidate, 0);
}

function requireSource(candidate: OptIrSlpCandidate, index: number): OptIrValueId {
  const valueId = candidate.sourceValueIds[index];
  if (valueId === undefined) {
    throw new Error(
      "SLP vector operation construction missing source values after legality checks.",
    );
  }
  return valueId;
}

function requiredSourceValueCount(candidate: OptIrSlpCandidate): number {
  switch (candidate.idiom) {
    case "endianDecode":
    case "fixedWidthCopy":
      return 1;
    case "fixedWidthSet":
      return 2;
    case "validationComparison":
    case "parserTableCheck":
      return candidate.lanes;
    case "adjacentPacketFieldRead":
    case "adjacentSourceFieldRead":
      return 0;
  }
}

function requireConstructedOperation(
  result:
    | ReturnType<typeof optIrVectorLoadOperation>
    | ReturnType<typeof optIrVectorStoreOperation>,
): OptIrOperation {
  if (result.kind === "error") {
    throw new Error("SLP vector operation construction failed after legality checks.");
  }
  return result.operation;
}
