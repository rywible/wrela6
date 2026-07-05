import type { AArch64AbiBinding, AArch64AbiLocation } from "../machine-ir/abi-location";
import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64AllocationResult } from "../backend/allocation/allocation-result";
import type { AArch64PhysicalRegisterModel } from "../backend/api/backend-catalog-interfaces";
import {
  aarch64PhysicalAliasMap,
  aarch64RegistersAlias,
} from "../backend/api/physical-register-helpers";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64AbiVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "abi",
  verify(context) {
    return context.program.functions
      .entries()
      .flatMap((machineFunction) => verifyAArch64Abi({ machineFunction, context }));
  },
};

export function verifyAArch64Abi(input: {
  readonly machineFunction: AArch64MachineFunction;
  readonly context: AArch64MachineVerifierContext;
}): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  diagnostics.push(...verifyAbiBindings(input));
  diagnostics.push(...verifyTiedOperands(input));
  for (const clobber of input.machineFunction.callClobbers) {
    if (!clobber.callKey.startsWith("call:")) {
      diagnostics.push(diagnostic(input.context, clobber.callKey, "call-site-key-invalid"));
    }
    if (clobber.registers.convention !== "aapcs64" || input.context.abi === undefined) continue;
    const expected = expectedClobbersFor(input.context, clobber.callKey);
    if (expected.kind === "error") {
      diagnostics.push(diagnostic(input.context, clobber.callKey, expected.stableDetail));
      continue;
    }
    for (const register of expected.registers.gpr) {
      if (!clobber.registers.gpr.includes(register)) {
        diagnostics.push(
          diagnostic(input.context, clobber.callKey, `aapcs64-clobber-missing:${register}`),
        );
      }
    }
    for (const register of expected.registers.vector) {
      if (!clobber.registers.vector.includes(register)) {
        diagnostics.push(
          diagnostic(input.context, clobber.callKey, `aapcs64-clobber-missing:${register}`),
        );
      }
    }
  }
  return diagnostics;
}

export function verifyAArch64CalleeSavedAllocationPreservation(input: {
  readonly allocation: AArch64AllocationResult;
  readonly savedRegisters: readonly string[];
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly context: Pick<AArch64MachineVerifierContext, "makeDiagnostic">;
}): readonly AArch64LoweringDiagnostic[] {
  const publicCalleeSavedRegisters = [
    ...input.registerModel.publicCalleeSavedGprs,
    ...input.registerModel.publicCalleeSavedSimd,
  ];
  if (publicCalleeSavedRegisters.length === 0) return [];

  const aliasPairs = input.registerModel.aliasSets.flatMap((aliasSet) =>
    aliasSet.aliases.flatMap((left, index) =>
      aliasSet.aliases.slice(index + 1).map((right) => ({ left, right })),
    ),
  );
  const aliasMap = aarch64PhysicalAliasMap(aliasPairs);
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const segment of input.allocation.segments) {
    const calleeSavedRegister = publicCalleeSavedRegisters.find((register) =>
      aarch64RegistersAlias(segment.physical, register, aliasMap),
    );
    if (calleeSavedRegister === undefined) continue;
    const isSaved = input.savedRegisters.some((savedRegister) =>
      aarch64RegistersAlias(savedRegister, calleeSavedRegister, aliasMap),
    );
    if (isSaved) continue;
    diagnostics.push(
      input.context.makeDiagnostic({
        code: "AARCH64_ABI_CALLEE_SAVED_UNPRESERVED",
        ownerKey: segment.liveRangeKey,
        rootCauseKey: "aapcs64",
        stableDetail: `callee-saved-unpreserved:${segment.physical}:${calleeSavedRegister}:${segment.startOrder}-${segment.endOrder}`,
      }),
    );
  }
  return Object.freeze(diagnostics);
}

function expectedClobbersFor(
  context: AArch64MachineVerifierContext,
  callKey: string,
):
  | {
      readonly kind: "ok";
      readonly registers: {
        readonly gpr: readonly string[];
        readonly vector: readonly string[];
      };
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  try {
    const classification = context.abi?.classifyCallClobbers({
      convention: "aapcs64",
      memoryEffects: [],
    });
    if (classification === undefined) {
      return {
        kind: "error",
        stableDetail: "aapcs64-clobber-target-abi-missing",
      };
    }
    if (classification.authorityFingerprint !== context.abi?.abiFingerprint) {
      return {
        kind: "error",
        stableDetail: `aapcs64-clobber-authority-mismatch:${callKey}`,
      };
    }
    return {
      kind: "ok",
      registers: classification.callClobbers.registers,
    };
  } catch (error) {
    return {
      kind: "error",
      stableDetail: `aapcs64-clobber-classification-error:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function verifyAbiBindings(input: {
  readonly machineFunction: AArch64MachineFunction;
  readonly context: AArch64MachineVerifierContext;
}): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  diagnostics.push(
    ...verifyBindingLocations(input.context, "parameter", input.machineFunction.parameters),
  );
  diagnostics.push(
    ...input.machineFunction.returns.flatMap((location, index) =>
      verifyLocation(input.context, `return:${index}`, "return", location),
    ),
  );
  const parameterLocations = new Map<string, string>();
  const stackParameters: AArch64AbiBinding[] = [];
  for (const parameter of input.machineFunction.parameters) {
    const key = locationKey(parameter.location);
    const prior = parameterLocations.get(key);
    if (prior !== undefined) {
      diagnostics.push(
        diagnostic(
          input.context,
          parameter.valueKey,
          `parameter-location-conflict:${prior}:${parameter.valueKey}:${key}`,
        ),
      );
    }
    parameterLocations.set(key, parameter.valueKey);
    if (parameter.location.kind === "stackArg") {
      stackParameters.push(parameter);
    }
  }
  diagnostics.push(...verifyStackArgumentRanges(input, stackParameters));
  const requiredIncomingArgSize = requiredStackArgumentAreaSize(
    stackParameters.map((parameter) => parameter.location),
  );
  const incomingArgAreaSize =
    input.machineFunction.frameObjects.find((frameObject) => frameObject.kind === "incomingArg")
      ?.size ?? 0;
  if (requiredIncomingArgSize > 0 && incomingArgAreaSize === 0) {
    diagnostics.push(
      diagnostic(
        input.context,
        `function:${input.machineFunction.functionId}`,
        "stack-arg-area-missing",
      ),
    );
  }
  if (requiredIncomingArgSize > incomingArgAreaSize && incomingArgAreaSize > 0) {
    diagnostics.push(
      diagnostic(
        input.context,
        `function:${input.machineFunction.functionId}`,
        `stack-arg-area-too-small:${incomingArgAreaSize}:${requiredIncomingArgSize}`,
      ),
    );
  }
  return diagnostics;
}

function verifyBindingLocations(
  context: AArch64MachineVerifierContext,
  label: string,
  bindings: readonly AArch64AbiBinding[],
): readonly AArch64LoweringDiagnostic[] {
  return bindings.flatMap((binding) =>
    verifyLocation(context, binding.valueKey, label, binding.location),
  );
}

function verifyLocation(
  context: AArch64MachineVerifierContext,
  ownerKey: string,
  label: string,
  location: AArch64AbiLocation,
): readonly AArch64LoweringDiagnostic[] {
  switch (location.kind) {
    case "intReg":
      return isValidRegisterIndex(location.index) && location.index <= 7
        ? []
        : [diagnostic(context, ownerKey, `${label}-int-reg-out-of-range:x${location.index}`)];
    case "vectorReg":
      return isValidRegisterIndex(location.index) && location.index <= 7
        ? []
        : [diagnostic(context, ownerKey, `${label}-vector-reg-out-of-range:v${location.index}`)];
    case "indirectResultPointer":
      return isValidRegisterIndex(location.index) && location.index <= 7
        ? []
        : [
            diagnostic(
              context,
              ownerKey,
              `${label}-indirect-result-out-of-range:x${location.index}`,
            ),
          ];
    case "stackArg":
      return Number.isInteger(location.ordinal) &&
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
        ? []
        : [
            diagnostic(
              context,
              ownerKey,
              `${label}-stack-arg-layout-invalid:${location.ordinal}:${location.offsetBytes}:${location.size}:${location.alignment}`,
            ),
          ];
  }
}

function isValidRegisterIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0;
}

function verifyStackArgumentRanges(
  input: {
    readonly machineFunction: AArch64MachineFunction;
    readonly context: AArch64MachineVerifierContext;
  },
  stackParameters: readonly AArch64AbiBinding[],
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  const sorted = [...stackParameters].sort((left, right) =>
    left.location.kind === "stackArg" && right.location.kind === "stackArg"
      ? left.location.offsetBytes - right.location.offsetBytes ||
        left.location.ordinal - right.location.ordinal
      : 0,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const prior = sorted[index - 1];
    const current = sorted[index];
    if (
      prior?.location.kind === "stackArg" &&
      current?.location.kind === "stackArg" &&
      prior.location.offsetBytes + prior.location.size > current.location.offsetBytes
    ) {
      diagnostics.push(
        diagnostic(
          input.context,
          current.valueKey,
          `stack-arg-range-overlap:${prior.valueKey}:${current.valueKey}:${prior.location.offsetBytes}:${prior.location.offsetBytes + prior.location.size}:${current.location.offsetBytes}:${current.location.offsetBytes + current.location.size}`,
        ),
      );
    }
  }
  return diagnostics;
}

function requiredStackArgumentAreaSize(locations: readonly AArch64AbiLocation[]): number {
  const stackLocations = locations.filter(
    (location): location is Extract<AArch64AbiLocation, { kind: "stackArg" }> =>
      location.kind === "stackArg",
  );
  if (stackLocations.length === 0) {
    return 0;
  }
  return alignUp(
    Math.max(...stackLocations.map((location) => location.offsetBytes + location.size)),
    16,
  );
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function verifyTiedOperands(input: {
  readonly machineFunction: AArch64MachineFunction;
  readonly context: AArch64MachineVerifierContext;
}): readonly AArch64LoweringDiagnostic[] {
  return input.machineFunction.blocks.flatMap((block) =>
    [...block.instructions, ...(block.terminator === undefined ? [] : [block.terminator])].flatMap(
      (instruction) => verifyInstructionTiedOperands(input.context, instruction),
    ),
  );
}

function verifyInstructionTiedOperands(
  context: AArch64MachineVerifierContext,
  instruction: AArch64MachineInstruction,
): readonly AArch64LoweringDiagnostic[] {
  return instruction.operands
    .filter((operand) => operand.role === "tiedDefUse" && operand.operand.kind !== "vreg")
    .map((_operand, index) =>
      diagnostic(
        context,
        `instruction:${instruction.instructionId}`,
        `tied-operand-invalid:${index}`,
      ),
    );
}

function locationKey(location: AArch64AbiLocation): string {
  switch (location.kind) {
    case "intReg":
    case "vectorReg":
    case "indirectResultPointer":
      return `${location.kind}:${location.index}`;
    case "stackArg":
      return `${location.kind}:${location.ordinal}:${location.offsetBytes}:${location.size}`;
  }
}

function diagnostic(
  context: AArch64MachineVerifierContext,
  callKey: string,
  stableDetail: string,
): AArch64LoweringDiagnostic {
  return context.makeDiagnostic({
    code: "AARCH64_ABI_CONTRACT_INVALID",
    ownerKey: callKey,
    rootCauseKey: "aapcs64",
    stableDetail,
  });
}
