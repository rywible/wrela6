import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import { aarch64FrameObjectId, aarch64SymbolId } from "../machine-ir/ids";
import {
  aarch64InstructionOperand,
  immediateOperand,
  implicitDefResource,
  symbolOperand,
  useVreg,
  defVreg,
  type AArch64InstructionOperand,
} from "../machine-ir/operands";
import { aarch64RelocationReference } from "../machine-ir/relocation-reference";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import { classifyAArch64AbiSignature } from "./abi-lowering";
import type {
  AArch64FirmwareArgumentRule,
  AArch64FirmwarePlatformCallLowering,
  AArch64FirmwareResultRule,
  AArch64FirmwareStaticChar16PointerArgument,
  AArch64FirmwareStaticChar16PointerRequirement,
  AArch64FirmwareTableFieldLayout,
} from "./firmware-platform-call-contract";
import {
  AARCH64_FIRMWARE_IMAGE_HANDLE_VALUE_KEY,
  AARCH64_FIRMWARE_SYSTEM_TABLE_VALUE_KEY,
} from "./firmware-platform-call-contract";
import { abiLocationKey, platformCallTargetKey } from "./materialization-contracts";
import {
  directCallSymbol,
  GPR64,
  POINTER,
  type OperationOf,
} from "./operation-materialization-helpers";
import { AArch64MemoryOperationMaterializer } from "./operation-materializer-memory";

type CallOperation = OperationOf<"sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall">;

const CALL_CLOBBER_OPERANDS = Object.freeze([
  implicitDefResource({ kind: "NZCV" }),
  implicitDefResource({ kind: "FPCR" }),
  implicitDefResource({ kind: "FPSR" }),
  implicitDefResource({ kind: "vectorState" }),
]);

export abstract class AArch64CallOperationMaterializer extends AArch64MemoryOperationMaterializer {
  protected materializeCall(
    operation: CallOperation,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    if (operation.kind === "intrinsicCall") {
      const intrinsicOperation = operation as OperationOf<"intrinsicCall">;
      const intrinsicResult = this.materializeStaticChar16IntrinsicResult(intrinsicOperation);
      if (intrinsicResult !== undefined) {
        return intrinsicResult;
      }
    }

    if (operation.kind === "platformCall" && this.context.firmware?.platformCalls !== undefined) {
      const platformOperation = operation as OperationOf<"platformCall">;
      const lowering = this.context.firmware.platformCalls.loweringFor(
        platformCallTargetKey(platformOperation.target),
      );
      if (lowering !== undefined) {
        return this.materializeFirmwarePlatformCall(platformOperation, lowering);
      }
    }

    const argumentMarshalling = this.materializeCallArguments(operation);
    if (argumentMarshalling.kind === "error") {
      return argumentMarshalling;
    }
    const directSymbol = directCallSymbol(operation.target);
    if (directSymbol === undefined) {
      const tableRegister = this.syntheticRegister(
        `call-target-page:${platformCallTargetKey(operation.target)}`,
        POINTER,
      );
      const slotRegister = this.syntheticRegister(
        `call-target-slot:${platformCallTargetKey(operation.target)}`,
        POINTER,
      );
      const targetRegister = this.syntheticRegister(
        `call-target:${platformCallTargetKey(operation.target)}`,
        POINTER,
      );
      const platformSymbol = aarch64SymbolId(`platform.${platformCallTargetKey(operation.target)}`);
      this.recordSymbolAddressRelocations(
        platformSymbol,
        "aarch64-relocation:platform-call-target",
      );
      this.emit(
        "adrp",
        [defVreg(tableRegister, tableRegister.type), symbolOperand(platformSymbol)],
        { mayTrap: false },
        "call-target",
        "integer",
      );
      this.emit(
        "add-pageoff",
        [
          defVreg(slotRegister, slotRegister.type),
          useVreg(tableRegister, tableRegister.type),
          immediateOperand(0n, slotRegister.type),
          symbolOperand(platformSymbol),
        ],
        { mayTrap: false },
        "call-target-pageoff",
        "integer",
      );
      this.emit(
        "ldr-unsigned-immediate",
        [
          defVreg(targetRegister, targetRegister.type),
          aarch64InstructionOperand({
            role: "memoryBase",
            operand: { kind: "vreg", register: slotRegister },
            type: slotRegister.type,
          }),
        ],
        { mayTrap: false, mayLoad: true },
        "call-target-pointer-load",
        "load",
      );
      this.emit(
        "blr",
        [
          useVreg(targetRegister, targetRegister.type),
          ...CALL_CLOBBER_OPERANDS,
          ...argumentMarshalling.callOperands,
        ],
        { mayTrap: false },
        operation.kind,
      );
      this.explanation.push(
        `call-lowering:indirect-platform:${platformCallTargetKey(operation.target)}`,
      );
    } else {
      this.recordCallRelocation(directSymbol);
      this.emit(
        "bl",
        [
          symbolOperand(directSymbol),
          ...CALL_CLOBBER_OPERANDS,
          ...argumentMarshalling.callOperands,
        ],
        { mayTrap: false },
        operation.kind,
      );
      this.explanation.push(`call-lowering:direct:${String(directSymbol)}`);
    }
    return this.materializeCallResults(operation);
  }

  private materializeStaticChar16IntrinsicResult(
    operation: OperationOf<"intrinsicCall">,
  ):
    | { readonly kind: "ok" }
    | { readonly kind: "error"; readonly stableDetail: string }
    | undefined {
    if (operation.target.kind !== "intrinsic" || operation.resultIds.length !== 1) {
      return undefined;
    }
    const resultValueKey = `optir.value:${String(operation.resultIds[0])}`;
    const pointer = this.context.firmware?.staticChar16Pointers?.get(resultValueKey);
    if (pointer === undefined) {
      return undefined;
    }
    if (operation.argumentIds.length !== 0) {
      return {
        kind: "error",
        stableDetail: `intrinsic-call-argument-mismatch:${String(operation.operationId)}:${operation.target.intrinsicKey}:expected:0:actual:${operation.argumentIds.length}`,
      };
    }

    const output = this.resultRegister(operation, 0);
    const pointerRegister = this.materializeStaticReadonlyPointer({
      symbolName: pointer.symbolName,
      stableKey: pointer.stableKey,
      fingerprint: pointer.fingerprint,
      label: "firmware-static-char16",
    });
    const copied = this.emitCopy(
      output,
      pointerRegister,
      `intrinsic-static-char16:${pointer.stableKey}`,
    );
    if (copied.kind === "error") {
      return {
        kind: "error",
        stableDetail: `intrinsic-call:invalid-static-char16-result:${String(operation.operationId)}:${operation.target.intrinsicKey}`,
      };
    }
    this.explanation.push(
      `intrinsic-call:static-char16-result:${operation.target.intrinsicKey}:${pointer.stableKey}`,
    );
    return { kind: "ok" };
  }

  private materializeFirmwarePlatformCall(
    operation: OperationOf<"platformCall">,
    lowering: AArch64FirmwarePlatformCallLowering,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    if (lowering.kind === "zero-runtime") {
      return this.materializeZeroRuntimePlatformCall(operation, lowering);
    }
    if (lowering.kind === "static-readonly-pointer-result") {
      return this.materializeStaticReadonlyPointerResult(operation, lowering);
    }
    if (lowering.kind === "constant-status") {
      return this.materializeConstantStatusPlatformCall(operation, lowering);
    }
    if (lowering.kind === "compiler-runtime-helper") {
      const argumentMarshalling = this.materializeFirmwareCallArguments(
        operation,
        lowering.argumentRules,
        undefined,
      );
      if (argumentMarshalling.kind === "error") return argumentMarshalling;
      const symbol = aarch64SymbolId(lowering.helperLinkageName);
      this.recordCallRelocation(symbol);
      this.emit(
        "bl",
        [symbolOperand(symbol), ...CALL_CLOBBER_OPERANDS, ...argumentMarshalling.callOperands],
        { mayTrap: false },
        "firmware-helper-call",
      );
      this.explanation.push(`firmware-platform-call:helper:${lowering.primitiveId}`);
      return this.materializeFirmwareCallResults(operation, lowering.resultRule);
    }

    const tablePointer = this.materializeFirmwareTablePointer(lowering);
    if (tablePointer.kind === "error") return tablePointer;
    const functionPointer = this.syntheticRegister(
      `firmware-function:${lowering.primitiveId}:${lowering.tableField.fieldKey}`,
      POINTER,
    );
    this.emit(
      "ldr-unsigned-immediate",
      [
        defVreg(functionPointer, functionPointer.type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: tablePointer.register },
          type: tablePointer.register.type,
        }),
        immediateOperand(BigInt(lowering.tableField.offsetBytes), POINTER),
      ],
      { mayTrap: false, mayLoad: true },
      `firmware-function-load:${lowering.tableField.fieldKey}`,
      "load",
    );
    const argumentMarshalling = this.materializeFirmwareCallArguments(
      operation,
      lowering.argumentRules,
      tablePointer.register,
    );
    if (argumentMarshalling.kind === "error") return argumentMarshalling;
    this.emit(
      "blr",
      [
        useVreg(functionPointer, functionPointer.type),
        ...CALL_CLOBBER_OPERANDS,
        ...argumentMarshalling.callOperands,
      ],
      { mayTrap: false },
      "firmware-call",
    );
    this.explanation.push(`firmware-platform-call:indirect:${lowering.primitiveId}`);
    return this.materializeFirmwareCallResults(operation, lowering.resultRule);
  }

  private materializeZeroRuntimePlatformCall(
    operation: OperationOf<"platformCall">,
    lowering: Extract<AArch64FirmwarePlatformCallLowering, { readonly kind: "zero-runtime" }>,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    for (let resultIndex = 0; resultIndex < operation.resultIds.length; resultIndex += 1) {
      const resultType = operation.resultTypes[resultIndex];
      if (
        resultType?.kind !== "zeroSized" &&
        resultType?.kind !== "unit" &&
        resultType?.kind !== "never"
      ) {
        return {
          kind: "error",
          stableDetail: `firmware-platform-call-zero-runtime-result:${String(operation.operationId)}:${lowering.primitiveId}:${resultIndex}:${resultType?.kind ?? "<missing>"}`,
        };
      }
      this.emitValueConstant(this.resultRegister(operation, resultIndex), 0n);
    }
    this.explanation.push(
      `firmware-platform-call:zero-runtime:${lowering.primitiveId}:${lowering.operationKey}`,
    );
    return { kind: "ok" };
  }

  private materializeConstantStatusPlatformCall(
    operation: OperationOf<"platformCall">,
    lowering: Extract<AArch64FirmwarePlatformCallLowering, { readonly kind: "constant-status" }>,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    if (operation.resultIds.length !== 1) {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call-result-mismatch:${String(operation.operationId)}:constant-status:expected:1:actual:${operation.resultIds.length}`,
      };
    }
    const resultType = operation.resultTypes[0];
    if (resultType?.kind !== "integer") {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call-constant-status-result:${String(operation.operationId)}:${lowering.primitiveId}:0:${resultType?.kind ?? "<missing>"}`,
      };
    }
    this.emitValueConstant(this.resultRegister(operation, 0), lowering.value);
    this.explanation.push(
      `firmware-platform-call:constant-status:${lowering.primitiveId}:${lowering.operationKey}`,
    );
    return { kind: "ok" };
  }

  private materializeStaticReadonlyPointerResult(
    operation: OperationOf<"platformCall">,
    lowering: Extract<
      AArch64FirmwarePlatformCallLowering,
      { readonly kind: "static-readonly-pointer-result" }
    >,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    if (operation.argumentIds.length !== 0) {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call-argument-mismatch:${String(operation.operationId)}:${lowering.primitiveId}:expected:0:actual:${operation.argumentIds.length}`,
      };
    }
    const expectedResultCount = firmwareResultCount(lowering.resultRule);
    if (operation.resultIds.length !== expectedResultCount) {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call-result-mismatch:${String(operation.operationId)}:${lowering.resultRule.kind}:expected:${expectedResultCount}:actual:${operation.resultIds.length}`,
      };
    }

    const output = this.resultRegister(operation, 0);
    const pointer = this.materializeStaticReadonlyPointer({
      symbolName: lowering.symbolName,
      stableKey: lowering.stableKey,
      fingerprint: lowering.fingerprint,
      label: "firmware-static-readonly-result",
    });
    const copied = this.emitCopy(
      output,
      pointer,
      `firmware-static-readonly-result:${lowering.stableKey}`,
    );
    if (copied.kind === "error") {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call:invalid-static-readonly-result:${String(operation.operationId)}:${lowering.primitiveId}`,
      };
    }
    this.explanation.push(
      `firmware-platform-call:static-readonly-pointer-result:${lowering.primitiveId}`,
    );
    return { kind: "ok" };
  }

  private materializeFirmwareTablePointer(
    lowering: Extract<AArch64FirmwarePlatformCallLowering, { readonly kind: "firmware-call" }>,
  ):
    | { readonly kind: "ok"; readonly register: AArch64VirtualRegister }
    | { readonly kind: "error"; readonly stableDetail: string } {
    if (lowering.tablePointerField === undefined) {
      return this.materializeFirmwareTableBase(lowering.tableField.base);
    }
    const tableBase = this.materializeFirmwareTableBase(lowering.tablePointerField.base);
    if (tableBase.kind === "error") return tableBase;
    return {
      kind: "ok",
      register: this.materializeFirmwareTableFieldLoad(
        tableBase.register,
        lowering.tablePointerField,
      ),
    };
  }

  private materializeFirmwareTableBase(
    base: AArch64FirmwareTableFieldLayout["base"],
  ):
    | { readonly kind: "ok"; readonly register: AArch64VirtualRegister }
    | { readonly kind: "error"; readonly stableDetail: string } {
    switch (base) {
      case "uefi-system-table":
        return this.firmwareContextRegister("system-table");
      case "uefi-simple-text-output":
        return {
          kind: "ok",
          register: this.syntheticRegister("firmware-base:uefi-simple-text-output", POINTER),
        };
      case "uefi-boot-services":
        return {
          kind: "ok",
          register: this.syntheticRegister("firmware-base:uefi-boot-services", POINTER),
        };
      case "uefi-runtime-services":
        return {
          kind: "ok",
          register: this.syntheticRegister("firmware-base:uefi-runtime-services", POINTER),
        };
    }
  }

  private materializeFirmwareTableFieldLoad(
    base: AArch64VirtualRegister,
    field: AArch64FirmwareTableFieldLayout,
  ): AArch64VirtualRegister {
    const tablePointer = this.syntheticRegister(`firmware-table:${field.fieldKey}`, POINTER);
    this.emit(
      "ldr-unsigned-immediate",
      [
        defVreg(tablePointer, tablePointer.type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: base },
          type: base.type,
        }),
        immediateOperand(BigInt(field.offsetBytes), POINTER),
      ],
      { mayTrap: false, mayLoad: true },
      `firmware-table-load:${field.fieldKey}`,
      "load",
    );
    return tablePointer;
  }

  private materializeFirmwareCallArguments(
    operation: OperationOf<"platformCall">,
    rules: readonly AArch64FirmwareArgumentRule[],
    tablePointer: AArch64VirtualRegister | undefined,
  ):
    | { readonly kind: "ok"; readonly callOperands: readonly AArch64InstructionOperand[] }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const sourceRegisters: AArch64VirtualRegister[] = [];
    const valueKeys: string[] = [];
    for (const rule of rules) {
      switch (rule.kind) {
        case "source-argument": {
          const argumentId = operation.argumentIds[rule.index];
          if (argumentId === undefined) {
            return {
              kind: "error",
              stableDetail: `materialize-operation:missing-source:${String(operation.operationId)}:${rule.index}`,
            };
          }
          const valueKey = `optir.value:${String(argumentId)}`;
          if (rule.pointerRequirement !== undefined) {
            const pointer = this.context.firmware?.staticChar16Pointers?.get(valueKey);
            if (pointer === undefined) {
              return {
                kind: "error",
                stableDetail: `firmware-platform-call:missing-static-char16-pointer:${String(operation.operationId)}:${valueKey}`,
              };
            }
            if (!staticChar16PointerSatisfiesRequirement(pointer, rule.pointerRequirement)) {
              return {
                kind: "error",
                stableDetail: `firmware-platform-call:invalid-static-char16-pointer:${String(operation.operationId)}:${valueKey}`,
              };
            }
            sourceRegisters.push(this.materializeStaticChar16Pointer(pointer));
            valueKeys.push(`firmware.static-char16:${pointer.stableKey}:${pointer.fingerprint}`);
            this.explanation.push(
              `firmware-pointer-requirement:${firmwarePointerRequirementKey(rule.pointerRequirement)}`,
            );
            break;
          }
          const source = this.sourceRegisterAt(operation.argumentIds, rule.index);
          if (source.kind === "error") return source;
          sourceRegisters.push(source.register);
          valueKeys.push(valueKey);
          break;
        }
        case "table-pointer":
          if (tablePointer === undefined) {
            return {
              kind: "error",
              stableDetail: `firmware-platform-call:missing-table-pointer:${String(operation.operationId)}`,
            };
          }
          sourceRegisters.push(tablePointer);
          valueKeys.push(`firmware.table-pointer:${String(operation.operationId)}`);
          break;
        case "image-handle":
        case "system-table": {
          const contextRegister = this.firmwareContextRegister(rule.kind);
          if (contextRegister.kind === "error") return contextRegister;
          sourceRegisters.push(contextRegister.register);
          valueKeys.push(rule.kind === "image-handle" ? "uefi.imageHandle" : "uefi.systemTable");
          break;
        }
        case "constant-u64": {
          const constant = this.syntheticRegister(
            `firmware-constant-u64:${rule.value.toString()}`,
            GPR64,
          );
          this.emitValueConstant(constant, rule.value);
          sourceRegisters.push(constant);
          valueKeys.push(`firmware.constant-u64:${rule.value.toString()}`);
          break;
        }
        case "static-char16-pointer": {
          const pointer = this.materializeStaticChar16Pointer(rule.pointer);
          sourceRegisters.push(pointer);
          valueKeys.push(
            `firmware.static-char16:${rule.pointer.stableKey}:${rule.pointer.fingerprint}`,
          );
          break;
        }
      }
    }
    return this.materializeRegistersAsCallArguments(operation, sourceRegisters, valueKeys);
  }

  private materializeStaticChar16Pointer(
    pointer: AArch64FirmwareStaticChar16PointerArgument,
  ): AArch64VirtualRegister {
    const pointerRegister = this.materializeStaticReadonlyPointer({
      symbolName: pointer.symbolName,
      stableKey: pointer.stableKey,
      fingerprint: pointer.fingerprint,
      label: "firmware-static-char16",
    });
    this.explanation.push(
      `firmware-static-char16-pointer:${pointer.stableKey}:${pointer.lifetime}:nul-terminated`,
    );
    return pointerRegister;
  }

  private materializeStaticReadonlyPointer(input: {
    readonly symbolName: string;
    readonly stableKey: string;
    readonly fingerprint: string;
    readonly label: string;
  }): AArch64VirtualRegister {
    const symbol = aarch64SymbolId(input.symbolName);
    const pageRegister = this.syntheticRegister(`${input.label}-page:${input.stableKey}`, POINTER);
    const pointerRegister = this.syntheticRegister(`${input.label}:${input.stableKey}`, POINTER);
    this.recordSymbolAddressRelocations(
      symbol,
      `aarch64-relocation:${input.label}:${input.fingerprint}`,
    );
    this.emit(
      "adrp",
      [defVreg(pageRegister, pageRegister.type), symbolOperand(symbol)],
      { mayTrap: false },
      `${input.label}-page:${input.stableKey}`,
      "integer",
    );
    this.emit(
      "add-pageoff",
      [
        defVreg(pointerRegister, pointerRegister.type),
        useVreg(pageRegister, pageRegister.type),
        immediateOperand(0n, pointerRegister.type),
        symbolOperand(symbol),
      ],
      { mayTrap: false },
      `${input.label}:${input.stableKey}`,
      "integer",
    );
    return pointerRegister;
  }

  private firmwareContextRegister(
    kind: "image-handle" | "system-table",
  ):
    | { readonly kind: "ok"; readonly register: AArch64VirtualRegister }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const sourceKey = kind === "image-handle" ? "uefi.imageHandle" : "uefi.systemTable";
    const registers = this.context.firmware?.contextRegisters;
    if (registers === undefined) {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call:missing-context-registers:${sourceKey}`,
      };
    }
    const existing = registers.get(sourceKey);
    if (existing !== undefined) return { kind: "ok", register: existing };
    const register = this.syntheticRegisterWithOrigin(
      `firmware-context:${kind}`,
      POINTER,
      sourceKey,
    );
    registers.set(sourceKey, register);
    return { kind: "ok", register };
  }

  private classifyCallReturnLocations(
    operation: CallOperation,
  ):
    | { readonly kind: "ok"; readonly locations: readonly AArch64AbiLocation[] }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const classified = classifyAArch64AbiSignature({
      abi: this.context.abi,
      role: "callReturns",
      callId: operation.callId,
      registerClasses: operation.resultIds.map(
        (resultId) => this.valueRegisters.get(resultId)?.registerClass ?? "gpr64",
      ),
      valueKeys: operation.resultIds.map((resultId) => `optir.value:${String(resultId)}`),
    });
    return classified.kind === "error"
      ? classified
      : { kind: "ok", locations: classified.classification.locations };
  }

  private recordCallRelocation(symbol: ReturnType<typeof aarch64SymbolId>): void {
    this.relocationReferences.push(
      aarch64RelocationReference({
        relocationId: this.nextRelocationReferenceId(),
        kind: "CALL26",
        symbol,
        addend: 0n,
        targetFingerprint: this.context.relocationTargetFingerprint ?? "aarch64-relocation:call26",
      }),
    );
  }

  private materializeCallArguments(
    operation: CallOperation,
  ):
    | { readonly kind: "ok"; readonly callOperands: readonly AArch64InstructionOperand[] }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const sourceRegisters: AArch64VirtualRegister[] = [];
    const valueKeys: string[] = [];
    if (operation.kind === "sourceCall" && this.context.firmware !== undefined) {
      const imageHandle = this.firmwareContextRegister("image-handle");
      if (imageHandle.kind === "error") return imageHandle;
      const systemTable = this.firmwareContextRegister("system-table");
      if (systemTable.kind === "error") return systemTable;
      sourceRegisters.push(imageHandle.register, systemTable.register);
      valueKeys.push(
        AARCH64_FIRMWARE_IMAGE_HANDLE_VALUE_KEY,
        AARCH64_FIRMWARE_SYSTEM_TABLE_VALUE_KEY,
      );
    }
    for (let index = 0; index < operation.argumentIds.length; index += 1) {
      const source = this.sourceRegisterAt(operation.argumentIds, index);
      if (source.kind === "error") return source;
      sourceRegisters.push(source.register);
      valueKeys.push(`optir.value:${String(operation.argumentIds[index])}`);
    }
    return this.materializeRegistersAsCallArguments(operation, sourceRegisters, valueKeys);
  }

  private materializeRegistersAsCallArguments(
    operation: CallOperation,
    sourceRegisters: readonly AArch64VirtualRegister[],
    valueKeys: readonly string[],
  ):
    | { readonly kind: "ok"; readonly callOperands: readonly AArch64InstructionOperand[] }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const callOperands: AArch64InstructionOperand[] = [];
    const classified = classifyAArch64AbiSignature({
      abi: this.context.abi,
      role: "callArguments",
      callId: operation.callId,
      registerClasses: sourceRegisters.map((sourceRegister) => sourceRegister.registerClass),
      valueKeys,
    });
    if (classified.kind === "error") {
      return classified;
    }
    const locations = classified.classification.locations;
    for (let index = 0; index < sourceRegisters.length; index += 1) {
      const sourceRegister = sourceRegisters[index];
      const location = locations[index];
      if (sourceRegister === undefined || location === undefined) {
        return {
          kind: "error",
          stableDetail: `call-argument-lowering-unsupported:${String(operation.operationId)}:${index}:<missing>:<missing>`,
        };
      }
      switch (location.kind) {
        case "intReg":
        case "vectorReg": {
          const abiRegister = this.syntheticRegister(
            `abi-arg:${abiLocationKey(location)}:${index}`,
            sourceRegister.type,
          );
          const copied = this.emitCopy(
            abiRegister,
            sourceRegister,
            `call-arg:${abiLocationKey(location)}:${index}`,
          );
          if (copied.kind === "error") {
            return {
              kind: "error",
              stableDetail: `call-argument-lowering-unsupported:${String(operation.operationId)}:${index}:${sourceRegister.registerClass}:${location.kind}`,
            };
          }
          callOperands.push(useVreg(abiRegister, abiRegister.type));
          break;
        }
        case "stackArg": {
          const stored = this.emitStackArgumentStore(sourceRegister, location, index);
          if (stored.kind === "error") {
            return {
              kind: "error",
              stableDetail: `call-argument-lowering-unsupported:${String(operation.operationId)}:${index}:${sourceRegister.registerClass}:${location.kind}`,
            };
          }
          break;
        }
        case "indirectResultPointer":
          return {
            kind: "error",
            stableDetail: `call-argument-lowering-unsupported:${String(operation.operationId)}:${index}:${sourceRegister.registerClass}:${location.kind}`,
          };
      }
    }
    return { kind: "ok", callOperands };
  }

  private materializeCallResults(
    operation: CallOperation,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const returnLocations = this.classifyCallReturnLocations(operation);
    if (returnLocations.kind === "error") {
      return returnLocations;
    }
    for (let resultIndex = 0; resultIndex < operation.resultIds.length; resultIndex += 1) {
      const output = this.resultRegister(operation, resultIndex);
      const location = returnLocations.locations[resultIndex];
      if (
        location === undefined ||
        location.kind === "stackArg" ||
        location.kind === "indirectResultPointer"
      ) {
        return {
          kind: "error",
          stableDetail: `call-result-lowering-unsupported:${String(operation.operationId)}:${resultIndex}:${output.registerClass}:${location?.kind ?? "<missing>"}`,
        };
      }
      const abiReturn = this.syntheticRegister(
        `abi-return:${abiLocationKey(location)}:${resultIndex}`,
        output.type,
      );
      const copied = this.emitCopy(
        output,
        abiReturn,
        `call-result:${abiLocationKey(location)}:${resultIndex}`,
      );
      if (copied.kind === "error") {
        return {
          kind: "error",
          stableDetail: `call-result-lowering-unsupported:${String(operation.operationId)}:${resultIndex}:${output.registerClass}`,
        };
      }
    }
    return { kind: "ok" };
  }

  private materializeFirmwareCallResults(
    operation: OperationOf<"platformCall">,
    resultRule: AArch64FirmwareResultRule,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const expectedResultCount = firmwareResultCount(resultRule);
    if (operation.resultIds.length !== expectedResultCount) {
      return {
        kind: "error",
        stableDetail: `firmware-platform-call-result-mismatch:${String(operation.operationId)}:${resultRule.kind}:expected:${expectedResultCount}:actual:${operation.resultIds.length}`,
      };
    }
    if (expectedResultCount === 0) {
      this.explanation.push(`firmware-result-rule:${resultRule.kind}`);
      return { kind: "ok" };
    }

    const materialized = this.materializeCallResults(operation);
    if (materialized.kind === "ok") {
      this.explanation.push(`firmware-result-rule:${firmwareResultRuleKey(resultRule)}`);
    }
    return materialized;
  }

  private emitStackArgumentStore(
    source: AArch64VirtualRegister,
    location: Extract<AArch64AbiLocation, { kind: "stackArg" }>,
    argumentIndex: number,
  ): { readonly kind: "ok" } | { readonly kind: "error" } {
    const memoryBase = aarch64InstructionOperand({
      role: "memoryBase",
      operand: { kind: "frameObject", frameObject: aarch64FrameObjectId(1) },
      type: POINTER,
    });
    const offset = immediateOperand(BigInt(location.offsetBytes), POINTER);
    if (source.registerClass === "gpr32" || source.registerClass === "gpr64") {
      this.emit(
        "str-unsigned-immediate",
        [useVreg(source, source.type), memoryBase, offset],
        { mayTrap: false, mayStore: true },
        `call-stack-arg:${argumentIndex}`,
        "store",
      );
      return { kind: "ok" };
    }
    if (source.registerClass === "vector128") {
      this.emit(
        "st1",
        [useVreg(source, source.type), memoryBase, offset],
        { mayTrap: false, mayStore: true },
        `call-stack-arg:${argumentIndex}`,
        "store",
      );
      return { kind: "ok" };
    }
    return { kind: "error" };
  }
}

function firmwareResultCount(resultRule: AArch64FirmwareResultRule): 0 | 1 {
  return resultRule.kind === "unit" ? 0 : 1;
}

function firmwareResultRuleKey(resultRule: AArch64FirmwareResultRule): string {
  return resultRule.kind === "pointer-result"
    ? `${resultRule.kind}:${resultRule.capabilityKey}`
    : resultRule.kind;
}

function firmwarePointerRequirementKey(
  requirement: AArch64FirmwareStaticChar16PointerRequirement,
): string {
  return `${requirement.kind}:${requirement.lifetime}:nul-terminated`;
}

function staticChar16PointerSatisfiesRequirement(
  pointer: AArch64FirmwareStaticChar16PointerArgument,
  requirement: AArch64FirmwareStaticChar16PointerRequirement,
): boolean {
  return (
    pointer.kind === requirement.kind &&
    pointer.lifetime === requirement.lifetime &&
    pointer.nulTerminated === requirement.nulTerminated
  );
}
