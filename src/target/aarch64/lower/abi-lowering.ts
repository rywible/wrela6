import type { OptIrCallId, OptIrValueId } from "../../../opt-ir/ids";
import {
  AAPCS64_CALLER_SAVED_GPRS,
  AAPCS64_PUBLIC_CALL_VECTOR_CLOBBERS,
} from "../aapcs64-registers";
import { aarch64AbiBinding, type AArch64AbiLocation } from "../machine-ir/abi-location";
import type { AArch64CallClobberRecord } from "../machine-ir/machine-function";
import type { AArch64RegisterClass } from "../machine-ir/machine-types";
import {
  EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
  type AArch64AbiConvention,
  type AArch64AbiSignatureClassification,
  type AArch64AbiSignatureClassificationInput,
  type AArch64AbiSignatureRole,
  type AArch64AbiTargetSurface,
  type AArch64CallClobberClassificationInput,
} from "../target-surface/target-surface";
import type { AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";

export { AAPCS64_CALLER_SAVED_GPRS };
export const AAPCS64_CALLER_SAVED_VECTORS = AAPCS64_PUBLIC_CALL_VECTOR_CLOBBERS;

export interface AArch64CallAbiLoweringInput {
  readonly abi?: AArch64AbiTargetSurface;
  readonly callId?: OptIrCallId;
  readonly convention: AArch64AbiConvention;
  readonly customAgreementKey?: string;
  readonly memoryEffects?: readonly string[];
}

export interface AArch64CallAbiLoweringResult {
  readonly callClobbers: AArch64CallClobberRecord;
  readonly stackAlignmentBytes: 16;
  readonly redZone: false;
}

export function lowerAArch64CallAbi(
  input: AArch64CallAbiLoweringInput,
): AArch64CallAbiLoweringResult {
  const lowered = classifyAArch64CallClobbers(input);
  if (lowered.kind === "error") {
    throw new RangeError(lowered.stableDetail);
  }
  return lowered.result;
}

export function bindAArch64ParameterLocation(input: {
  readonly value: OptIrValueId;
  readonly location: AArch64AbiLocation;
}): ReturnType<typeof aarch64AbiBinding> {
  return aarch64AbiBinding({
    valueKey: `optir.value:${String(input.value)}`,
    location: input.location,
  });
}

export function aarch64AbiLocationForRegister(
  registerClass: AArch64RegisterClass,
  ordinal: number,
): AArch64AbiLocation {
  if (ordinal >= 8) {
    const stackShape = stackArgumentShape(registerClass);
    const stackOrdinal = ordinal - 8;
    return {
      kind: "stackArg",
      ordinal: stackOrdinal,
      offsetBytes: stackOrdinal * stackShape.size,
      size: stackShape.size,
      alignment: stackShape.alignment,
    };
  }
  return registerClass === "vector64" ||
    registerClass === "vector128" ||
    registerClass === "fpScalar"
    ? { kind: "vectorReg", index: ordinal }
    : { kind: "intReg", index: ordinal };
}

export function assignAArch64AbiLocationsForRegisters(
  registerClasses: readonly AArch64RegisterClass[],
  abi: AArch64AbiTargetSurface = defaultAArch64AbiTargetSurface(),
  options: {
    readonly role?: AArch64AbiSignatureRole;
    readonly reservedIntegerRegisters?: number;
    readonly valueKeys?: readonly string[];
    readonly callId?: OptIrCallId;
    readonly convention?: AArch64AbiConvention;
    readonly customAgreementKey?: string;
  } = {},
): readonly AArch64AbiLocation[] {
  const classified = classifyAArch64AbiSignature({
    abi,
    registerClasses,
    role: options.role ?? "callArguments",
    reservedIntegerRegisters: options.reservedIntegerRegisters,
    valueKeys: options.valueKeys,
    callId: options.callId,
    convention: options.convention,
    customAgreementKey: options.customAgreementKey,
  });
  if (classified.kind === "error") {
    throw new RangeError(classified.stableDetail);
  }
  return classified.classification.locations;
}

export type AArch64AbiSignatureLoweringResult =
  | {
      readonly kind: "ok";
      readonly classification: AArch64AbiSignatureClassification;
    }
  | { readonly kind: "error"; readonly stableDetail: string };

export function classifyAArch64AbiSignature(input: {
  readonly abi?: AArch64AbiTargetSurface;
  readonly role: AArch64AbiSignatureRole;
  readonly registerClasses: readonly AArch64RegisterClass[];
  readonly reservedIntegerRegisters?: number;
  readonly valueKeys?: readonly string[];
  readonly callId?: OptIrCallId;
  readonly convention?: AArch64AbiConvention;
  readonly customAgreementKey?: string;
}): AArch64AbiSignatureLoweringResult {
  const abi = input.abi ?? defaultAArch64AbiTargetSurface();
  let classification: AArch64AbiSignatureClassification;
  try {
    classification = abi.classifySignature({
      role: input.role,
      values: input.registerClasses.map((registerClass, index) => ({
        registerClass,
        ...(input.valueKeys?.[index] === undefined ? {} : { valueKey: input.valueKeys[index] }),
      })),
      reservedIntegerRegisters: input.reservedIntegerRegisters,
      callId: input.callId,
      convention: input.convention,
      customAgreementKey: input.customAgreementKey,
    });
  } catch (error) {
    return {
      kind: "error",
      stableDetail: `abi-classification:exception:${input.role}:${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const validation = validateAArch64AbiClassificationAuthority({
    abi,
    classification,
    expectedLocations: input.registerClasses.length,
    role: input.role,
  });
  if (validation.kind === "error") {
    return validation;
  }
  return {
    kind: "ok",
    classification: freezeSignatureClassification(classification),
  };
}

export type AArch64CallClobberLoweringResult =
  | { readonly kind: "ok"; readonly result: AArch64CallAbiLoweringResult }
  | { readonly kind: "error"; readonly stableDetail: string };

export function classifyAArch64CallClobbers(
  input: AArch64CallAbiLoweringInput,
): AArch64CallClobberLoweringResult {
  const abi = input.abi ?? defaultAArch64AbiTargetSurface();
  try {
    const classification = abi.classifyCallClobbers({
      callId: input.callId,
      convention: input.convention,
      customAgreementKey: input.customAgreementKey,
      memoryEffects: input.memoryEffects,
    });
    if (classification.authorityFingerprint !== abi.abiFingerprint) {
      return {
        kind: "error",
        stableDetail: `abi-classification:authority-mismatch:call-clobbers:expected:${abi.abiFingerprint}:actual:${classification.authorityFingerprint}`,
      };
    }
    return {
      kind: "ok",
      result: Object.freeze({
        callClobbers: Object.freeze({
          ...classification.callClobbers,
          registers: Object.freeze({
            convention: classification.callClobbers.registers.convention,
            gpr: Object.freeze([...classification.callClobbers.registers.gpr]),
            vector: Object.freeze([...classification.callClobbers.registers.vector]),
          }),
          memoryEffects: Object.freeze([...classification.callClobbers.memoryEffects]),
        }),
        stackAlignmentBytes: classification.stackAlignmentBytes,
        redZone: classification.redZone,
      }),
    };
  } catch (error) {
    return {
      kind: "error",
      stableDetail: `abi-classification:exception:call-clobbers:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function createAArch64Aapcs64AbiTargetSurface(
  abiFingerprint = EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.abi,
): AArch64AbiTargetSurface {
  return Object.freeze({
    abiFingerprint,
    classifySignature(input: AArch64AbiSignatureClassificationInput) {
      const locations = assignAArch64Aapcs64LocationsForRegisters(
        input.values.map((value) => value.registerClass),
        input.reservedIntegerRegisters ?? 0,
      );
      return freezeSignatureClassification({
        authorityFingerprint: abiFingerprint,
        convention: input.convention ?? "aapcs64",
        locations,
        stackArgumentAreaSizeBytes: aarch64StackArgumentAreaSize(
          locations.filter(isStackArgumentLocation),
        ),
      });
    },
    classifyCallClobbers(input: AArch64CallClobberClassificationInput) {
      if (input.convention === "custom" && (input.customAgreementKey ?? "").length === 0) {
        throw new RangeError("custom AArch64 ABI lowering requires a closed agreement key.");
      }
      const registers =
        input.convention === "aapcs64"
          ? {
              convention: "aapcs64" as const,
              gpr: AAPCS64_CALLER_SAVED_GPRS,
              vector: AAPCS64_CALLER_SAVED_VECTORS,
            }
          : { convention: "custom" as const, gpr: [], vector: [] };
      return Object.freeze({
        authorityFingerprint: abiFingerprint,
        callClobbers: Object.freeze({
          callKey: input.callId === undefined ? "call:synthetic" : `call:${String(input.callId)}`,
          registers: Object.freeze({
            convention: registers.convention,
            gpr: Object.freeze([...registers.gpr]),
            vector: Object.freeze([...registers.vector]),
          }),
          memoryEffects: Object.freeze([...(input.memoryEffects ?? [])].sort()),
        }),
        stackAlignmentBytes: 16,
        redZone: false,
      });
    },
  });
}

function assignAArch64Aapcs64LocationsForRegisters(
  registerClasses: readonly AArch64RegisterClass[],
  reservedIntegerRegisters = 0,
): readonly AArch64AbiLocation[] {
  let integerOrdinal = 0;
  let vectorOrdinal = 0;
  let stackOrdinal = 0;
  let overflowOffset = 0;
  let reserved = reservedIntegerRegisters;
  return Object.freeze(
    registerClasses.map((registerClass) => {
      if (!isVectorLikeRegisterClass(registerClass)) {
        while (reserved > 0 && integerOrdinal < 8) {
          integerOrdinal += 1;
          reserved -= 1;
        }
      }
      if (isVectorLikeRegisterClass(registerClass)) {
        if (vectorOrdinal < 8) {
          const location = aarch64AbiLocationForRegister(registerClass, vectorOrdinal);
          vectorOrdinal += 1;
          return location;
        }
      } else if (integerOrdinal < 8) {
        const location = aarch64AbiLocationForRegister(registerClass, integerOrdinal);
        integerOrdinal += 1;
        return location;
      }
      const stackShape = stackArgumentShape(registerClass);
      overflowOffset = alignUp(overflowOffset, stackShape.alignment);
      const location: AArch64AbiLocation = {
        kind: "stackArg",
        ordinal: stackOrdinal,
        offsetBytes: overflowOffset,
        size: stackShape.size,
        alignment: stackShape.alignment,
      };
      stackOrdinal += 1;
      overflowOffset += stackShape.size;
      return location;
    }),
  );
}

export function aarch64StackArgumentAreaSize(
  locations: readonly Extract<AArch64AbiLocation, { kind: "stackArg" }>[],
): number {
  if (locations.length === 0) {
    return 0;
  }
  return alignUp(
    Math.max(...locations.map((location) => location.offsetBytes + location.size)),
    16,
  );
}

function stackArgumentShape(registerClass: AArch64RegisterClass): {
  readonly size: number;
  readonly alignment: number;
} {
  return registerClass === "vector128" ? { size: 16, alignment: 16 } : { size: 8, alignment: 8 };
}

function isVectorLikeRegisterClass(registerClass: AArch64RegisterClass): boolean {
  return (
    registerClass === "vector64" || registerClass === "vector128" || registerClass === "fpScalar"
  );
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function validateAArch64AbiClassificationAuthority(input: {
  readonly abi: AArch64AbiTargetSurface;
  readonly classification: AArch64AbiSignatureClassification;
  readonly expectedLocations: number;
  readonly role: AArch64AbiSignatureRole;
}): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
  if (input.classification.authorityFingerprint !== input.abi.abiFingerprint) {
    return {
      kind: "error",
      stableDetail: `abi-classification:authority-mismatch:${input.role}:expected:${input.abi.abiFingerprint}:actual:${input.classification.authorityFingerprint}`,
    };
  }
  if (input.classification.locations.length !== input.expectedLocations) {
    return {
      kind: "error",
      stableDetail: `abi-classification:location-count-mismatch:${input.role}:expected:${input.expectedLocations}:actual:${input.classification.locations.length}`,
    };
  }
  for (const [index, location] of input.classification.locations.entries()) {
    const invalidLocationDetail = invalidAArch64AbiLocationDetail(location);
    if (invalidLocationDetail !== undefined) {
      return {
        kind: "error",
        stableDetail: `abi-classification:invalid-location:${input.role}:${index}:${invalidLocationDetail}`,
      };
    }
  }
  const requiredStackAreaSize = aarch64StackArgumentAreaSize(
    input.classification.locations.filter(isStackArgumentLocation),
  );
  if (input.classification.stackArgumentAreaSizeBytes < requiredStackAreaSize) {
    return {
      kind: "error",
      stableDetail: `abi-classification:stack-area-too-small:${input.role}:expected-at-least:${requiredStackAreaSize}:actual:${input.classification.stackArgumentAreaSizeBytes}`,
    };
  }
  return { kind: "ok" };
}

function invalidAArch64AbiLocationDetail(location: AArch64AbiLocation): string | undefined {
  switch (location.kind) {
    case "intReg":
      return isValidAArch64AbiRegisterIndex(location.index)
        ? undefined
        : `int-reg-out-of-range:x${location.index}`;
    case "vectorReg":
      return isValidAArch64AbiRegisterIndex(location.index)
        ? undefined
        : `vector-reg-out-of-range:v${location.index}`;
    case "indirectResultPointer":
      return isValidAArch64AbiRegisterIndex(location.index)
        ? undefined
        : `indirect-result-out-of-range:x${location.index}`;
    case "stackArg":
      return isValidAArch64StackArgumentLocation(location)
        ? undefined
        : `stack-arg-layout-invalid:${location.ordinal}:${location.offsetBytes}:${location.size}:${location.alignment}`;
  }
}

function isValidAArch64AbiRegisterIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= 7;
}

function isValidAArch64StackArgumentLocation(
  location: Extract<AArch64AbiLocation, { kind: "stackArg" }>,
): boolean {
  return (
    Number.isInteger(location.ordinal) &&
    location.ordinal >= 0 &&
    Number.isInteger(location.offsetBytes) &&
    location.offsetBytes >= 0 &&
    Number.isInteger(location.size) &&
    location.size > 0 &&
    Number.isInteger(location.alignment) &&
    location.alignment > 0 &&
    location.alignment % 8 === 0 &&
    location.size % 8 === 0 &&
    location.offsetBytes % location.alignment === 0
  );
}

function freezeSignatureClassification(
  classification: AArch64AbiSignatureClassification,
): AArch64AbiSignatureClassification {
  return Object.freeze({
    authorityFingerprint: classification.authorityFingerprint,
    convention: classification.convention,
    locations: Object.freeze(classification.locations.map((location) => Object.freeze(location))),
    stackArgumentAreaSizeBytes: classification.stackArgumentAreaSizeBytes,
  });
}

function isStackArgumentLocation(
  location: AArch64AbiLocation,
): location is Extract<AArch64AbiLocation, { kind: "stackArg" }> {
  return location.kind === "stackArg";
}

let cachedDefaultAbiTargetSurface: AArch64AbiTargetSurface | undefined;

function defaultAArch64AbiTargetSurface(): AArch64AbiTargetSurface {
  cachedDefaultAbiTargetSurface ??= createAArch64Aapcs64AbiTargetSurface();
  return cachedDefaultAbiTargetSurface;
}

export function lowerAArch64AbiStageState(state: AArch64LoweringState): AArch64LoweringState {
  return recordAArch64StagePlanning(state, "lower-abi", "aapcs64-stack-alignment:16:no-red-zone");
}
