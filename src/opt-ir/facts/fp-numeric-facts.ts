import type { OptIrFactId, OptIrOperationId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";

export type OptIrFpContraction = "forbidden" | "allowed" | "required";
export type OptIrFpRoundingMode =
  | "nearestTiesToEven"
  | "towardZero"
  | "towardPositive"
  | "towardNegative";

const FP_NUMERIC_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "fp-numeric",
  packetKinds: ["fp-numeric"],
  preservationRules: ["preserve-through-fp-stable-clone"],
  invalidationRules: ["invalidate-on-fp-rewrite"],
  upstreamVerifierKey: "fp-numeric-facts",
  negativeFixtures: ["invalid-error-bound"],
});

export interface OptIrFpNumericFactInput {
  readonly factId: OptIrFactId;
  readonly operationId: OptIrOperationId;
  readonly contraction?: OptIrFpContraction;
  readonly rounding?: OptIrFpRoundingMode;
  readonly exceptionFlagsObservable?: boolean;
  readonly precision?: "fp16" | "fp32" | "fp64";
  readonly laneWidthBits?: number;
  readonly signedness?: "signed" | "unsigned";
  readonly accumulation?: "none" | "sameWidth" | "widening";
  readonly saturation?: "none" | "signed" | "unsigned";
  readonly errorBoundUlps?: number;
  readonly signedZero?: "preserve" | "ignore";
  readonly nanPayload?: "preserve" | "default";
  readonly flushToZero?: boolean;
  readonly numericRange?: Readonly<Record<string, unknown>>;
}

export function fpNumericFactRecord(input: OptIrFpNumericFactInput): OptIrFactRecord {
  if (input.errorBoundUlps !== undefined && input.errorBoundUlps < 0) {
    throw new RangeError("FP numeric error bound must be non-negative.");
  }
  if (
    input.laneWidthBits !== undefined &&
    (!Number.isInteger(input.laneWidthBits) || input.laneWidthBits <= 0)
  ) {
    throw new RangeError("FP numeric lane width must be a positive integer.");
  }
  return optIrExtensionFactRecord({
    registry: FP_NUMERIC_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "fp-numeric",
    packetKind: "fp-numeric",
    subject: { kind: "operation", operationId: input.operationId },
    payload: {
      ...(input.contraction === undefined ? {} : { contraction: input.contraction }),
      ...(input.rounding === undefined ? {} : { rounding: input.rounding }),
      ...(input.exceptionFlagsObservable === undefined
        ? {}
        : { exceptionFlagsObservable: input.exceptionFlagsObservable }),
      ...(input.precision === undefined ? {} : { precision: input.precision }),
      ...(input.laneWidthBits === undefined ? {} : { laneWidthBits: input.laneWidthBits }),
      ...(input.signedness === undefined ? {} : { signedness: input.signedness }),
      ...(input.accumulation === undefined ? {} : { accumulation: input.accumulation }),
      ...(input.saturation === undefined ? {} : { saturation: input.saturation }),
      ...(input.errorBoundUlps === undefined ? {} : { errorBoundUlps: input.errorBoundUlps }),
      ...(input.signedZero === undefined ? {} : { signedZero: input.signedZero }),
      ...(input.nanPayload === undefined ? {} : { nanPayload: input.nanPayload }),
      ...(input.flushToZero === undefined ? {} : { flushToZero: input.flushToZero }),
      ...(input.numericRange === undefined ? {} : { numericRange: input.numericRange }),
    },
    authority: "proof:fp-numeric",
  });
}
