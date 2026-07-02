import type { AArch64BackendTargetSurface } from "../aarch64/backend/api/backend-target-surface";
import {
  aarch64ObjectByteProvenance,
  type AArch64ByteProvenanceRecord,
} from "../aarch64/backend/object/object-module";
import {
  encodeAArch64PhysicalInstructionForTarget,
  type AArch64PhysicalInstructionToEncode,
} from "../aarch64/backend/object/encoding";
import type { UefiFirmwareTableFieldRecord } from "./firmware-tables";
import type { UefiAArch64ExitBootServicesPolicy } from "./exit-boot-services";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import type { UefiAArch64StatusPolicy } from "./status-conversion";
import type { UefiAArch64EntryWatchdogPolicy } from "./watchdog-policy";

export const HELPER_VERIFIER_KEY = "uefi-aarch64.runtime-helper-objects";
export const TEXT_SECTION_KEY = ".text";

export interface EncodedHelperInstruction {
  readonly opcodeLabel: string;
  readonly semanticLabel?: string;
  readonly bytes: readonly number[];
}

export function encodeStatusFromBootResultInstructions(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
}): UefiAArch64TargetResult<readonly EncodedHelperInstruction[]> {
  const instructions: EncodedHelperInstruction[] = [];
  const append = (
    opcodeLabel: string,
    instructionToEncode: AArch64PhysicalInstructionToEncode,
    semanticLabel?: string,
  ): boolean => {
    const result = encodeAArch64PhysicalInstructionForTarget({
      instruction: instructionToEncode,
      encodingCatalog: input.backendTarget.encodingCatalog,
      registerModel: input.backendTarget.registerModel,
    });
    if (result.kind === "error") return false;
    instructions.push(
      Object.freeze({
        opcodeLabel,
        semanticLabel,
        bytes: Object.freeze([...result.value.bytes]),
      }),
    );
    return true;
  };
  const appendStatusConstant = (value: bigint, semanticLabel: string): boolean =>
    append("movz", instruction("movz", reg("x0"), imm(statusWord(value, 0))), semanticLabel) &&
    append(
      "movk",
      instruction("movk", reg("x0"), imm(statusWord(value, 1)), imm(16n)),
      semanticLabel,
    ) &&
    append(
      "movk",
      instruction("movk", reg("x0"), imm(statusWord(value, 2)), imm(32n)),
      semanticLabel,
    ) &&
    append(
      "movk",
      instruction("movk", reg("x0"), imm(statusWord(value, 3)), imm(48n)),
      semanticLabel,
    );

  const branchCases = sourceBootResultStatusBranchCases();
  const success =
    branchCases.every(
      (branchCase) =>
        append(
          "movz",
          instruction("movz", reg("x9"), imm(branchCase.sourceCode)),
          `source-code:${branchCase.sourceCode.toString()}`,
        ) &&
        append(
          "cmp",
          instruction("cmp-shifted-register", reg("x0"), reg("x9")),
          `compare-source-code:${branchCase.sourceCode.toString()}`,
        ) &&
        append(
          "b-cond",
          condBranch("eq", 0),
          `branch-source-code:${branchCase.sourceCode.toString()}`,
        ),
    ) &&
    appendStatusConstant(input.statusPolicy.aborted, "return-aborted") &&
    append("ret", instruction("ret"), "return-aborted") &&
    sourceBootResultStatusReturnCases(input.statusPolicy).every(
      (returnCase) =>
        returnCase.semanticLabel === "return-aborted" ||
        (appendStatusConstant(returnCase.status, returnCase.semanticLabel) &&
          append("ret", instruction("ret"), returnCase.semanticLabel)),
    );

  if (!success) {
    return uefiAArch64Error({
      diagnostics: [runtimeHelperDiagnostic("status-from-boot-result:instruction-encoding-failed")],
      verification: failedVerification(HELPER_VERIFIER_KEY, "status-from-boot-result-encode"),
    });
  }

  for (const branchCase of branchCases) {
    patchBranch19AtLabel(
      instructions,
      `branch-source-code:${branchCase.sourceCode.toString()}`,
      branchCase.targetLabel,
    );
  }

  return uefiAArch64Ok({
    value: Object.freeze(instructions),
    verification: passedVerification(HELPER_VERIFIER_KEY, "status-from-boot-result-encode"),
  });
}

export function encodeEntryInitializeContextInstructions(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly bootServicesPointer: UefiFirmwareTableFieldRecord;
  readonly setWatchdogTimer: UefiFirmwareTableFieldRecord;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
}): UefiAArch64TargetResult<readonly EncodedHelperInstruction[]> {
  const instructions: EncodedHelperInstruction[] = [];
  const frameSizeBytes = 16n;
  const linkRegisterOffsetBytes = 8n;
  const append = (
    opcodeLabel: string,
    instruction: AArch64PhysicalInstructionToEncode,
    semanticLabel?: string,
  ): boolean => {
    const result = encodeAArch64PhysicalInstructionForTarget({
      instruction,
      encodingCatalog: input.backendTarget.encodingCatalog,
      registerModel: input.backendTarget.registerModel,
    });
    if (result.kind === "error") return false;
    instructions.push(
      Object.freeze({ opcodeLabel, semanticLabel, bytes: Object.freeze([...result.value.bytes]) }),
    );
    return true;
  };
  const appendReturnEpilogue = (): boolean =>
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x30"), mem("sp"), imm(linkRegisterOffsetBytes)),
      "restore-link-register",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("sp"), reg("sp"), imm(frameSizeBytes)),
      "free-helper-frame",
    ) &&
    append("ret", instruction("ret"));

  const success =
    append(
      "sub-immediate",
      instruction("sub-immediate", reg("sp"), reg("sp"), imm(frameSizeBytes)),
      "allocate-helper-frame",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x30"), mem("sp"), imm(linkRegisterOffsetBytes)),
      "save-link-register",
    ) &&
    append("cbz", branch("cbz", "x1", 0), "guard-system-table") &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x3"),
        mem("x1"),
        imm(BigInt(input.bootServicesPointer.offsetBytes)),
      ),
    ) &&
    append("cbz", branch("cbz", "x3", 0), "guard-boot-services") &&
    (input.watchdogPolicy.kind === "disable-before-source"
      ? append(
          "ldr-unsigned-immediate",
          instruction(
            "ldr-unsigned-immediate",
            reg("x9"),
            mem("x3"),
            imm(BigInt(input.setWatchdogTimer.offsetBytes)),
          ),
        ) &&
        append("movz", instruction("movz", reg("x0"), imm(0n))) &&
        append("movz", instruction("movz", reg("x1"), imm(0n))) &&
        append("movz", instruction("movz", reg("x2"), imm(0n))) &&
        append("movz", instruction("movz", reg("x3"), imm(0n))) &&
        append("blr", instruction("blr", reg("x9"))) &&
        append(
          "movz",
          instruction("movz", reg("x10"), imm(statusWord(input.statusPolicy.unsupported, 0))),
        ) &&
        append(
          "movk",
          instruction(
            "movk",
            reg("x10"),
            imm(statusWord(input.statusPolicy.unsupported, 1)),
            imm(16n),
          ),
        ) &&
        append(
          "movk",
          instruction(
            "movk",
            reg("x10"),
            imm(statusWord(input.statusPolicy.unsupported, 2)),
            imm(32n),
          ),
        ) &&
        append(
          "movk",
          instruction(
            "movk",
            reg("x10"),
            imm(statusWord(input.statusPolicy.unsupported, 3)),
            imm(48n),
          ),
        ) &&
        append("cmp", instruction("cmp-shifted-register", reg("x0"), reg("x10"))) &&
        append("b-cond", condBranch("eq", 0), "branch-watchdog-unsupported") &&
        append("movz", instruction("movz", reg("x10"), imm(0n))) &&
        append("cmp", instruction("cmp-shifted-register", reg("x0"), reg("x10"))) &&
        append("b-cond", condBranch("ne", 0), "branch-watchdog-failed")
      : append("movz", instruction("movz", reg("x0"), imm(0n)))) &&
    append("movz", instruction("movz", reg("x0"), imm(0n)), "return-success") &&
    append("movz", instruction("movz", reg("x1"), imm(1n))) &&
    appendReturnEpilogue() &&
    append(
      "movz",
      instruction("movz", reg("x0"), imm(statusWord(input.statusPolicy.invalidParameter, 0))),
      "return-invalid-parameter",
    ) &&
    append(
      "movk",
      instruction(
        "movk",
        reg("x0"),
        imm(statusWord(input.statusPolicy.invalidParameter, 1)),
        imm(16n),
      ),
    ) &&
    append(
      "movk",
      instruction(
        "movk",
        reg("x0"),
        imm(statusWord(input.statusPolicy.invalidParameter, 2)),
        imm(32n),
      ),
    ) &&
    append(
      "movk",
      instruction(
        "movk",
        reg("x0"),
        imm(statusWord(input.statusPolicy.invalidParameter, 3)),
        imm(48n),
      ),
    ) &&
    append("movz", instruction("movz", reg("x1"), imm(0n))) &&
    appendReturnEpilogue() &&
    append("movz", instruction("movz", reg("x1"), imm(0n)), "return-watchdog-status") &&
    appendReturnEpilogue();

  if (!success) {
    return uefiAArch64Error({
      diagnostics: [
        runtimeHelperDiagnostic("entry-initialize-context:instruction-encoding-failed"),
      ],
      verification: failedVerification(HELPER_VERIFIER_KEY, "entry-initialize-context-encode"),
    });
  }

  const controlFlow = patchControlFlow(instructions, input.watchdogPolicy);
  if (controlFlow.kind === "error") {
    return uefiAArch64Error({
      diagnostics: [runtimeHelperDiagnostic(controlFlow.stableDetail)],
      verification: failedVerification(HELPER_VERIFIER_KEY, "entry-initialize-context-encode"),
    });
  }
  return uefiAArch64Ok({
    value: Object.freeze(instructions),
    verification: passedVerification(HELPER_VERIFIER_KEY, "entry-initialize-context-encode"),
  });
}

export function encodeExitBootServicesWithFreshMapInstructions(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly bootServicesPointer: UefiFirmwareTableFieldRecord;
  readonly getMemoryMap: UefiFirmwareTableFieldRecord;
  readonly allocatePool: UefiFirmwareTableFieldRecord;
  readonly exitBootServices: UefiFirmwareTableFieldRecord;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly exitBootServicesPolicy: UefiAArch64ExitBootServicesPolicy;
}): UefiAArch64TargetResult<readonly EncodedHelperInstruction[]> {
  const instructions: EncodedHelperInstruction[] = [];
  const frameSizeBytes = 4080n;
  const mapBufferOffsetBytes = 96n;
  const mapBufferSizeBytes = frameSizeBytes - mapBufferOffsetBytes;
  const growthCounterOffsetBytes = 88n;
  const bufferCapacityOffsetBytes = 80n;
  const bufferPointerOffsetBytes = 72n;
  const efiLoaderDataMemoryType = 2n;
  const append = (
    opcodeLabel: string,
    instructionToEncode: AArch64PhysicalInstructionToEncode,
    semanticLabel?: string,
  ): boolean => {
    const result = encodeAArch64PhysicalInstructionForTarget({
      instruction: instructionToEncode,
      encodingCatalog: input.backendTarget.encodingCatalog,
      registerModel: input.backendTarget.registerModel,
    });
    if (result.kind === "error") return false;
    instructions.push(
      Object.freeze({
        opcodeLabel,
        semanticLabel,
        bytes: Object.freeze([...result.value.bytes]),
      }),
    );
    return true;
  };
  const appendStatusConstant = (register: string, value: bigint, semanticLabel: string): boolean =>
    append("movz", instruction("movz", reg(register), imm(statusWord(value, 0))), semanticLabel) &&
    append(
      "movk",
      instruction("movk", reg(register), imm(statusWord(value, 1)), imm(16n)),
      semanticLabel,
    ) &&
    append(
      "movk",
      instruction("movk", reg(register), imm(statusWord(value, 2)), imm(32n)),
      semanticLabel,
    ) &&
    append(
      "movk",
      instruction("movk", reg(register), imm(statusWord(value, 3)), imm(48n)),
      semanticLabel,
    );

  const attemptCount = BigInt(input.exitBootServicesPolicy.maxInvalidParameterRetries + 1);
  const maxBufferTooSmallRetries = BigInt(input.exitBootServicesPolicy.maxBufferTooSmallRetries);
  const descriptorSlackBytes = BigInt(input.exitBootServicesPolicy.initialDescriptorSlackBytes);
  const success =
    append(
      "sub-immediate",
      instruction("sub-immediate", reg("sp"), reg("sp"), imm(frameSizeBytes)),
      "allocate-helper-frame",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x30"), mem("sp"), imm(48n)),
      "save-link-register",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x19"), mem("sp"), imm(56n)),
      "save-retry-register",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x20"), mem("sp"), imm(64n)),
      "save-status-register",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(32n)),
      "save-image-handle",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x1"), mem("sp"), imm(40n)),
      "save-system-table",
    ) &&
    append("cbz", branch("cbz", "x1", 0), "guard-system-table") &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x3"),
        mem("x1"),
        imm(BigInt(input.bootServicesPointer.offsetBytes)),
      ),
      "load-boot-services",
    ) &&
    append("cbz", branch("cbz", "x3", 0), "guard-boot-services") &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x0"), reg("sp"), imm(mapBufferOffsetBytes)),
      "set-initial-memory-map-buffer",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(bufferPointerOffsetBytes)),
      "store-memory-map-buffer-pointer",
    ) &&
    append(
      "movz",
      instruction("movz", reg("x0"), imm(mapBufferSizeBytes)),
      "set-initial-memory-map-capacity",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(bufferCapacityOffsetBytes)),
      "store-memory-map-buffer-capacity",
    ) &&
    append("movz", instruction("movz", reg("x0"), imm(0n)), "set-buffer-growth-count-zero") &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(growthCounterOffsetBytes)),
      "store-buffer-growth-count",
    ) &&
    append("movz", instruction("movz", reg("x19"), imm(attemptCount)), "set-retry-bound") &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x3"), mem("sp"), imm(40n)),
      "refresh-get-memory-map",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x3"),
        mem("x3"),
        imm(BigInt(input.bootServicesPointer.offsetBytes)),
      ),
      "refresh-boot-services-for-get-memory-map",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x9"),
        mem("x3"),
        imm(BigInt(input.getMemoryMap.offsetBytes)),
      ),
      "load-get-memory-map",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x0"), mem("sp"), imm(bufferCapacityOffsetBytes)),
      "load-memory-map-capacity",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(0n)),
      "store-memory-map-size",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x0"), reg("sp"), imm(0n)),
      "prepare-memory-map-size-pointer",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x1"), mem("sp"), imm(bufferPointerOffsetBytes)),
      "prepare-memory-map-buffer",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x2"), reg("sp"), imm(8n)),
      "prepare-map-key-pointer",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x3"), reg("sp"), imm(16n)),
      "prepare-descriptor-size-pointer",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x4"), reg("sp"), imm(24n)),
      "prepare-descriptor-version-pointer",
    ) &&
    append("blr", instruction("blr", reg("x9")), "call-get-memory-map") &&
    appendStatusConstant("x20", input.statusPolicy.success, "status-success") &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x0"), reg("x20")),
      "compare-get-memory-map",
    ) &&
    append("b-cond", condBranch("eq", 0), "branch-get-memory-map-succeeded") &&
    appendStatusConstant("x20", input.statusPolicy.bufferTooSmall, "status-buffer-too-small") &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x0"), reg("x20")),
      "compare-buffer-too-small",
    ) &&
    append("b-cond", condBranch("ne", 0), "branch-get-memory-map-failed") &&
    append("movz", instruction("movz", reg("x20"), imm(attemptCount)), "status-initial-attempt") &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x19"), reg("x20")),
      "compare-buffer-growth-before-exit-failure",
    ) &&
    append("b-cond", condBranch("ne", 0), "branch-buffer-growth-after-exit-failure") &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x20"), mem("sp"), imm(growthCounterOffsetBytes)),
      "load-buffer-growth-count",
    ) &&
    append(
      "movz",
      instruction("movz", reg("x3"), imm(maxBufferTooSmallRetries)),
      "set-buffer-growth-bound",
    ) &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x20"), reg("x3")),
      "compare-buffer-growth-budget",
    ) &&
    append("b-cond", condBranch("eq", 0), "branch-buffer-growth-budget-exhausted") &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x3"), mem("sp"), imm(40n)),
      "reload-system-table-for-allocate-pool",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x3"),
        mem("x3"),
        imm(BigInt(input.bootServicesPointer.offsetBytes)),
      ),
      "reload-boot-services-for-allocate-pool",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x10"),
        mem("x3"),
        imm(BigInt(input.allocatePool.offsetBytes)),
      ),
      "load-allocate-pool",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x1"), mem("sp"), imm(0n)),
      "load-required-memory-map-size",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x1"), reg("x1"), imm(descriptorSlackBytes)),
      "add-memory-map-size-slack",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x1"), mem("sp"), imm(bufferCapacityOffsetBytes)),
      "store-grown-memory-map-capacity",
    ) &&
    append(
      "movz",
      instruction("movz", reg("x0"), imm(efiLoaderDataMemoryType)),
      "prepare-allocate-pool-memory-type",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x2"), reg("sp"), imm(bufferPointerOffsetBytes)),
      "prepare-allocate-pool-buffer-pointer",
    ) &&
    append("blr", instruction("blr", reg("x10")), "call-allocate-pool") &&
    appendStatusConstant("x20", input.statusPolicy.success, "status-allocate-pool-success") &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x0"), reg("x20")),
      "compare-allocate-pool-status",
    ) &&
    append("b-cond", condBranch("ne", 0), "branch-allocate-pool-failed") &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x20"), mem("sp"), imm(growthCounterOffsetBytes)),
      "reload-buffer-growth-count",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("x20"), reg("x20"), imm(1n)),
      "increment-buffer-growth-count",
    ) &&
    append(
      "str-unsigned-immediate",
      instruction("str-unsigned-immediate", reg("x20"), mem("sp"), imm(growthCounterOffsetBytes)),
      "store-incremented-buffer-growth-count",
    ) &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x20"), reg("x20")),
      "compare-allocate-pool-succeeded",
    ) &&
    append("b-cond", condBranch("eq", 0), "branch-retry-after-buffer-growth") &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x1"), mem("sp"), imm(8n)),
      "load-recorded-map-key",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x0"), mem("sp"), imm(32n)),
      "reload-image-handle",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x3"), mem("sp"), imm(40n)),
      "reload-system-table",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x3"),
        mem("x3"),
        imm(BigInt(input.bootServicesPointer.offsetBytes)),
      ),
      "reload-boot-services",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction(
        "ldr-unsigned-immediate",
        reg("x10"),
        mem("x3"),
        imm(BigInt(input.exitBootServices.offsetBytes)),
      ),
      "load-exit-boot-services",
    ) &&
    append("blr", instruction("blr", reg("x10")), "call-exit-boot-services") &&
    appendStatusConstant("x20", input.statusPolicy.invalidParameter, "status-invalid-parameter") &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x0"), reg("x20")),
      "compare-exit-status",
    ) &&
    append("b-cond", condBranch("ne", 0), "branch-exit-not-stale-key") &&
    append(
      "sub-immediate",
      instruction("sub-immediate", reg("x19"), reg("x19"), imm(1n)),
      "consume-retry-budget",
    ) &&
    append("movz", instruction("movz", reg("x20"), imm(0n)), "status-zero") &&
    append(
      "cmp",
      instruction("cmp-shifted-register", reg("x19"), reg("x20")),
      "compare-retry-budget",
    ) &&
    append("b-cond", condBranch("ne", 0), "branch-retry-with-fresh-map") &&
    appendStatusConstant("x0", input.statusPolicy.invalidParameter, "return-invalid-parameter") &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x20"), mem("sp"), imm(64n)),
      "restore-status-register",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x19"), mem("sp"), imm(56n)),
      "restore-retry-register",
    ) &&
    append(
      "ldr-unsigned-immediate",
      instruction("ldr-unsigned-immediate", reg("x30"), mem("sp"), imm(48n)),
      "restore-link-register",
    ) &&
    append(
      "add-immediate",
      instruction("add-immediate", reg("sp"), reg("sp"), imm(frameSizeBytes)),
      "free-helper-frame",
    ) &&
    append("ret", instruction("ret"), "restore-and-return");

  if (!success) {
    return uefiAArch64Error({
      diagnostics: [runtimeHelperDiagnostic("exit-boot-services:instruction-encoding-failed")],
      verification: failedVerification(HELPER_VERIFIER_KEY, "exit-boot-services-encode"),
    });
  }

  const controlFlow = patchExitBootServicesControlFlow(instructions);
  if (controlFlow.kind === "error") {
    return uefiAArch64Error({
      diagnostics: [runtimeHelperDiagnostic(controlFlow.stableDetail)],
      verification: failedVerification(HELPER_VERIFIER_KEY, "exit-boot-services-encode"),
    });
  }
  return uefiAArch64Ok({
    value: Object.freeze(instructions),
    verification: passedVerification(HELPER_VERIFIER_KEY, "exit-boot-services-encode"),
  });
}

export function byteProvenanceForInstructions(input: {
  readonly helperKey: string;
  readonly factFamilies: readonly string[];
  readonly instructions: readonly EncodedHelperInstruction[];
}): readonly AArch64ByteProvenanceRecord[] {
  let offsetBytes = 0;
  return Object.freeze(
    input.instructions.map((instruction, index) => {
      const semanticPrefix =
        instruction.semanticLabel === undefined ? "" : `${instruction.semanticLabel}:`;
      const record = aarch64ObjectByteProvenance({
        stableKey: `byte:${input.helperKey}:${index}:${semanticPrefix}${instruction.opcodeLabel}`,
        sectionKey: TEXT_SECTION_KEY,
        startOffsetBytes: offsetBytes,
        byteLength: instruction.bytes.length,
        source: `${input.helperKey}:instruction:${semanticPrefix}${instruction.opcodeLabel}`,
        factFamilies: input.factFamilies,
      });
      offsetBytes += instruction.bytes.length;
      return record;
    }),
  );
}

export function runtimeHelperDiagnostic(stableDetail: string) {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: "runtime-helper-objects",
    stableDetail,
  });
}

type PatchControlFlowResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly stableDetail: string };

function patchControlFlow(
  instructions: EncodedHelperInstruction[],
  watchdogPolicy: UefiAArch64EntryWatchdogPolicy,
): PatchControlFlowResult {
  for (const [branchLabel, targetLabel] of [
    ["guard-system-table", "return-invalid-parameter"],
    ["guard-boot-services", "return-invalid-parameter"],
  ] as const) {
    const result = patchBranch19AtLabel(instructions, branchLabel, targetLabel);
    if (result.kind === "error") return result;
  }
  if (watchdogPolicy.kind === "disable-before-source") {
    for (const [branchLabel, targetLabel] of [
      ["branch-watchdog-unsupported", "return-success"],
      ["branch-watchdog-failed", "return-watchdog-status"],
    ] as const) {
      const result = patchBranch19AtLabel(instructions, branchLabel, targetLabel);
      if (result.kind === "error") return result;
    }
  }
  return { kind: "ok" };
}

function patchExitBootServicesControlFlow(
  instructions: EncodedHelperInstruction[],
): PatchControlFlowResult {
  for (const [branchLabel, targetLabel] of [
    ["guard-system-table", "return-invalid-parameter"],
    ["guard-boot-services", "return-invalid-parameter"],
    ["branch-get-memory-map-succeeded", "load-recorded-map-key"],
    ["branch-get-memory-map-failed", "restore-status-register"],
    ["branch-buffer-growth-after-exit-failure", "restore-status-register"],
    ["branch-buffer-growth-budget-exhausted", "restore-status-register"],
    ["branch-allocate-pool-failed", "restore-status-register"],
    ["branch-retry-after-buffer-growth", "refresh-get-memory-map"],
    ["branch-exit-not-stale-key", "restore-status-register"],
    ["branch-retry-with-fresh-map", "refresh-get-memory-map"],
  ] as const) {
    const result = patchBranch19AtLabel(instructions, branchLabel, targetLabel);
    if (result.kind === "error") return result;
  }
  return { kind: "ok" };
}

function patchBranch19AtLabel(
  instructions: EncodedHelperInstruction[],
  branchLabel: string,
  targetLabel: string,
): PatchControlFlowResult {
  const branchIndex = instructionIndexOfSemanticLabel(instructions, branchLabel);
  const targetIndex = instructionIndexOfSemanticLabel(instructions, targetLabel);
  if (branchIndex === undefined) {
    return {
      kind: "error",
      stableDetail: `helper-control-flow:missing-label:${branchLabel}`,
    };
  }
  if (targetIndex === undefined) {
    return {
      kind: "error",
      stableDetail: `helper-control-flow:missing-label:${targetLabel}`,
    };
  }
  patchBranch19At(instructions, branchIndex, byteOffsetOf(instructions, targetIndex));
  return { kind: "ok" };
}

function instructionIndexOfSemanticLabel(
  instructions: readonly EncodedHelperInstruction[],
  semanticLabel: string,
): number | undefined {
  const index = instructions.findIndex(
    (instruction) => instruction.semanticLabel === semanticLabel,
  );
  return index < 0 ? undefined : index;
}

function patchBranch19At(
  instructions: EncodedHelperInstruction[],
  instructionIndex: number,
  targetOffsetBytes: number,
): void {
  const branchOffsetBytes = byteOffsetOf(instructions, instructionIndex);
  instructions[instructionIndex] = Object.freeze({
    ...instructions[instructionIndex]!,
    bytes: patchBranch19(
      instructions[instructionIndex]!.bytes,
      targetOffsetBytes - branchOffsetBytes,
    ),
  });
}

function byteOffsetOf(instructions: readonly EncodedHelperInstruction[], endIndex: number): number {
  return instructions
    .slice(0, endIndex)
    .reduce((sum, instruction) => sum + instruction.bytes.length, 0);
}

function patchBranch19(bytes: readonly number[], distanceBytes: number): readonly number[] {
  const word = ((bytes[3]! << 24) | (bytes[2]! << 16) | (bytes[1]! << 8) | bytes[0]!) >>> 0;
  const immediate = (distanceBytes / 4) & 0x7ffff;
  const patched = (word & ~0x00ffffe0) | (immediate << 5);
  return Object.freeze([
    patched & 0xff,
    (patched >>> 8) & 0xff,
    (patched >>> 16) & 0xff,
    (patched >>> 24) & 0xff,
  ]);
}

function sourceBootResultStatusBranchCases(): readonly {
  readonly sourceCode: bigint;
  readonly targetLabel: string;
}[] {
  return Object.freeze([
    { sourceCode: 0n, targetLabel: "return-success" },
    { sourceCode: 1n, targetLabel: "return-loadError" },
    { sourceCode: 2n, targetLabel: "return-invalidParameter" },
    { sourceCode: 3n, targetLabel: "return-unsupported" },
    { sourceCode: 4n, targetLabel: "return-badBufferSize" },
    { sourceCode: 5n, targetLabel: "return-bufferTooSmall" },
    { sourceCode: 6n, targetLabel: "return-deviceError" },
    { sourceCode: 7n, targetLabel: "return-notFound" },
    { sourceCode: 8n, targetLabel: "return-aborted" },
    { sourceCode: 9n, targetLabel: "return-securityViolation" },
    { sourceCode: 10n, targetLabel: "return-aborted" },
  ]);
}

function sourceBootResultStatusReturnCases(
  policy: UefiAArch64StatusPolicy,
): readonly { readonly semanticLabel: string; readonly status: bigint }[] {
  return Object.freeze([
    { semanticLabel: "return-success", status: policy.success },
    { semanticLabel: "return-loadError", status: policy.loadError },
    { semanticLabel: "return-invalidParameter", status: policy.invalidParameter },
    { semanticLabel: "return-unsupported", status: policy.unsupported },
    { semanticLabel: "return-badBufferSize", status: policy.badBufferSize },
    { semanticLabel: "return-bufferTooSmall", status: policy.bufferTooSmall },
    { semanticLabel: "return-deviceError", status: policy.deviceError },
    { semanticLabel: "return-notFound", status: policy.notFound },
    { semanticLabel: "return-aborted", status: policy.aborted },
    { semanticLabel: "return-securityViolation", status: policy.securityViolation },
  ]);
}

function statusWord(value: bigint, wordIndex: number): bigint {
  return (value >> BigInt(wordIndex * 16)) & 0xffffn;
}

function instruction(
  opcode: string,
  ...operands: AArch64PhysicalInstructionToEncode["operands"]
): AArch64PhysicalInstructionToEncode {
  return { opcode, operands, accessWidthBytes: 8 };
}

function branch(
  opcode: "cbz",
  register: string,
  targetIndex: number,
): AArch64PhysicalInstructionToEncode {
  return {
    opcode,
    operands: [reg(register), { kind: "relocation-target", target: `local.${targetIndex}` }],
    relocation: { family: "branch19", target: `local.${targetIndex}` },
  };
}

function condBranch(condition: string, targetIndex: number): AArch64PhysicalInstructionToEncode {
  return {
    opcode: "b-cond",
    operands: [
      { kind: "condition", condition },
      { kind: "relocation-target", target: `local.${targetIndex}` },
    ],
    relocation: { family: "branch19", target: `local.${targetIndex}` },
  };
}

function reg(register: string) {
  return { kind: "register" as const, register };
}

function mem(register: string) {
  return { kind: "memory-base" as const, register };
}

function imm(value: bigint) {
  return { kind: "immediate" as const, value };
}
