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
import { abiLocationKey, platformCallTargetKey } from "./materialization-contracts";
import { directCallSymbol, POINTER, type OperationOf } from "./operation-materialization-helpers";
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
    const callOperands: AArch64InstructionOperand[] = [];
    const sourceRegisters: AArch64VirtualRegister[] = [];
    for (let index = 0; index < operation.argumentIds.length; index += 1) {
      const source = this.sourceRegisterAt(operation.argumentIds, index);
      if (source.kind === "error") return source;
      sourceRegisters.push(source.register);
    }
    const classified = classifyAArch64AbiSignature({
      abi: this.context.abi,
      role: "callArguments",
      callId: operation.callId,
      registerClasses: sourceRegisters.map((sourceRegister) => sourceRegister.registerClass),
      valueKeys: operation.argumentIds.map((argumentId) => `optir.value:${String(argumentId)}`),
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
