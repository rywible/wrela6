import type { OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrMemoryAccessDescriptor } from "../../../opt-ir/operations";
import { aarch64SymbolId, type AArch64FrameObjectId } from "../machine-ir/ids";
import {
  aarch64MemoryOrderingMetadata,
  type AArch64RegionMemoryType,
} from "../machine-ir/memory-order";
import {
  aarch64InstructionOperand,
  type AArch64InstructionOperand,
  defVreg,
  immediateOperand,
  symbolOperand,
  useVreg,
} from "../machine-ir/operands";
import {
  aarch64SymbolReference,
  type AArch64SymbolReference,
} from "../machine-ir/symbol-reference";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import { selectAArch64AddressingMode } from "../select/addressing-selection";
import {
  abstractAddressBaseForKey,
  addResolvedMemoryAddressBasisOffset,
  isBaseOnlyMemoryOpcode,
  isScalarOrderedMemoryOpcode,
  isVectorMemoryOperation,
  memoryAccessScheduleMetadata,
  validateTargetMemoryAlignment,
  type AArch64MaterializedMemoryAddress,
  type AArch64MaterializedMemoryBase,
  type AArch64ResolvedMemoryAddressBasis,
} from "./materialization-contracts";
import { lowerAArch64MemoryOrder } from "./memory-order-lowering";
import {
  asAArch64MemoryOrder,
  POINTER,
  type OperationOf,
} from "./operation-materialization-helpers";
import type { AArch64RegionMemoryTypeDecision } from "./operation-materialization";
import { AArch64OperationMaterializerBase } from "./operation-materializer-base";
import { regionAddressBasisStableKey, type AArch64RegionAddressBasis } from "./region-lowering";

export abstract class AArch64MemoryOperationMaterializer extends AArch64OperationMaterializerBase {
  protected materializeMemoryLoad(
    operation: OperationOf<"memoryLoad" | "vectorLoad" | "vectorMaskedLoad">,
    fallbackOpcode: "ldr-unsigned-immediate" | "ld1",
    accessKind: "load",
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const output = this.resultRegister(operation, 0);
    const sequence = this.memoryOpcodeSequence(operation, accessKind, fallbackOpcode);
    if (sequence.kind === "error") {
      return sequence;
    }
    const widthCheck = this.validateDirectVectorMemoryWidth(operation, fallbackOpcode, output);
    if (widthCheck.kind === "error") {
      return widthCheck;
    }
    const address = this.materializeAddressForAccess(
      "memory-load-address",
      operation.memoryAccess,
      sequence.memoryOrdering.regionMemoryType,
    );
    if (address.kind === "error") {
      return address;
    }
    for (const opcode of sequence.opcodes) {
      if (opcode === "dmb" || opcode === "dsb") {
        this.emitBarrierOpcode(opcode, operation.kind);
        continue;
      }
      const addressOperands = this.memoryAddressOperandsForOpcode(
        opcode,
        address,
        "memory-load-address",
      );
      if (addressOperands.kind === "error") {
        return addressOperands;
      }
      this.emit(
        opcode,
        [defVreg(output, output.type), ...addressOperands.operands],
        { mayTrap: false, mayLoad: true },
        operation.kind,
        "load",
        sequence.memoryOrdering,
        memoryAccessScheduleMetadata(opcode, "load", operation.memoryAccess),
      );
    }
    return { kind: "ok" };
  }

  protected materializeMemoryStore(
    operation: OperationOf<"memoryStore" | "vectorStore" | "vectorMaskedStore">,
    fallbackOpcode: "str-unsigned-immediate" | "st1",
    valueId: OptIrValueId,
    accessKind: "store",
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const stored = this.valueRegister(valueId);
    const sequence = this.memoryOpcodeSequence(operation, accessKind, fallbackOpcode);
    if (sequence.kind === "error") {
      return sequence;
    }
    const widthCheck = this.validateDirectVectorMemoryWidth(operation, fallbackOpcode, stored);
    if (widthCheck.kind === "error") {
      return widthCheck;
    }
    const address = this.materializeAddressForAccess(
      "memory-store-address",
      operation.memoryAccess,
      sequence.memoryOrdering.regionMemoryType,
    );
    if (address.kind === "error") {
      return address;
    }
    for (const opcode of sequence.opcodes) {
      if (opcode === "dmb" || opcode === "dsb") {
        this.emitBarrierOpcode(opcode, operation.kind);
        continue;
      }
      const addressOperands = this.memoryAddressOperandsForOpcode(
        opcode,
        address,
        "memory-store-address",
      );
      if (addressOperands.kind === "error") {
        return addressOperands;
      }
      this.emit(
        opcode,
        [useVreg(stored, stored.type), ...addressOperands.operands],
        { mayTrap: false, mayStore: true },
        operation.kind,
        "store",
        sequence.memoryOrdering,
        memoryAccessScheduleMetadata(opcode, "store", operation.memoryAccess),
      );
    }
    return { kind: "ok" };
  }

  private validateDirectVectorMemoryWidth(
    operation: OperationOf<
      | "memoryLoad"
      | "vectorLoad"
      | "vectorMaskedLoad"
      | "memoryStore"
      | "vectorStore"
      | "vectorMaskedStore"
    >,
    opcode: "ldr-unsigned-immediate" | "ld1" | "str-unsigned-immediate" | "st1",
    register: AArch64VirtualRegister,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    if (opcode !== "ld1" && opcode !== "st1") {
      return { kind: "ok" };
    }
    if (register.registerClass === "vector128") {
      return { kind: "ok" };
    }
    return {
      kind: "error",
      stableDetail: `vector-memory-width:unsupported-direct-access:${String(operation.operationId)}:${operation.kind}:${register.registerClass}:${opcode}`,
    };
  }

  protected materializeAddImmediate(
    output: AArch64VirtualRegister,
    base: AArch64VirtualRegister,
    immediate: bigint,
    label: string,
  ): { readonly kind: "ok" } {
    this.emit(
      "add-immediate",
      [
        defVreg(output, output.type),
        useVreg(base, base.type),
        immediateOperand(immediate, output.type),
      ],
      { mayTrap: false },
      label,
    );
    return { kind: "ok" };
  }

  protected materializeOffsetAdd(
    output: AArch64VirtualRegister,
    base: AArch64VirtualRegister,
    offset: bigint,
    label: string,
  ): { readonly kind: "ok" } {
    if (offset >= 0n && offset <= 4095n) {
      return this.materializeAddImmediate(output, base, offset, label);
    }
    const offsetRegister = this.syntheticRegister(`${label}:offset`, output.type);
    this.emitValueConstant(offsetRegister, offset);
    this.emit(
      "add-shifted-register",
      [
        defVreg(output, output.type),
        useVreg(base, base.type),
        useVreg(offsetRegister, offsetRegister.type),
      ],
      { mayTrap: false },
      label,
    );
    return { kind: "ok" };
  }

  protected emitBarrierOpcode(opcode: "dmb" | "dsb", label: string): void {
    this.emit(opcode, [], { mayTrap: false }, label, "barrier");
  }

  private memoryOpcodeSequence(
    operation: OperationOf<
      | "memoryLoad"
      | "memoryStore"
      | "vectorLoad"
      | "vectorMaskedLoad"
      | "vectorStore"
      | "vectorMaskedStore"
    >,
    accessKind: "load" | "store",
    fallbackOpcode: string,
  ):
    | {
        readonly kind: "ok";
        readonly opcodes: readonly string[];
        readonly memoryOrdering: ReturnType<typeof aarch64MemoryOrderingMetadata>;
      }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const regionDecision = this.regionMemoryTypeForAccess(operation.memoryAccess);
    const alignment = validateTargetMemoryAlignment({
      operationId: Number(operation.operationId),
      access: operation.memoryAccess,
      regionMemoryType: regionDecision.regionMemoryType,
    });
    if (alignment.kind === "error") {
      return alignment;
    }
    const orderAnswer = this.context.factQuery?.memoryOrderForOperation(operation.operationId);
    if (orderAnswer !== undefined) {
      this.recordFactAnswer(orderAnswer);
    }
    const order = orderAnswer?.kind === "yes" ? asAArch64MemoryOrder(orderAnswer.order) : undefined;
    const publicationShape =
      orderAnswer?.kind === "yes" && typeof orderAnswer.publicationShape === "string"
        ? orderAnswer.publicationShape
        : undefined;
    const lowered = lowerAArch64MemoryOrder({
      accessKind,
      regionMemoryType: regionDecision.regionMemoryType,
      ...(order === undefined ? {} : { order }),
      ...(publicationShape === undefined ? {} : { publicationShape }),
    });
    if (lowered.kind === "error") {
      return {
        kind: "error",
        stableDetail: `${lowered.reason}:operation:${String(operation.operationId)}`,
      };
    }
    if (
      isVectorMemoryOperation(operation) &&
      lowered.instructions.some(isScalarOrderedMemoryOpcode)
    ) {
      return {
        kind: "error",
        stableDetail: `vector-memory-order:unsupported-ordered-access:${String(operation.operationId)}:${operation.kind}:${order ?? "required"}`,
      };
    }
    const opcodes = lowered.instructions.length === 0 ? [fallbackOpcode] : lowered.instructions;
    return {
      kind: "ok",
      opcodes,
      memoryOrdering: aarch64MemoryOrderingMetadata({
        order: order ?? "relaxed",
        regionMemoryType: regionDecision.regionMemoryType,
        barrierDomain: {
          domain: publicationShape?.includes("virtio") ? "outerShareable" : "system",
          access: accessKind === "load" ? "loads" : "stores",
        },
        atomicity: order === undefined ? "nonAtomic" : "singleCopyAtomic",
      }),
    };
  }

  private regionMemoryTypeForAccess(
    access: OptIrMemoryAccessDescriptor,
  ): AArch64RegionMemoryTypeDecision {
    const decision =
      this.context.regionMemoryTypeForRegion?.(access.region) ??
      ({
        regionMemoryType:
          access.volatility === "volatile" ? "externalConservative" : "normalCacheable",
        factsUsed: [],
        explanation: [`region-memory-type:default:${String(access.region)}`],
      } satisfies AArch64RegionMemoryTypeDecision);
    this.recordDecision(decision);
    if (access.validatedBuffer !== undefined) {
      const validatedDecision: AArch64RegionMemoryTypeDecision = {
        regionMemoryType: "validatedPayload",
        factsUsed: decision.factsUsed,
        explanation: [
          ...decision.explanation,
          `validated-buffer:zero-copy:${access.validatedBuffer.fieldName}`,
        ],
      };
      this.recordDecision(validatedDecision);
      return validatedDecision;
    }
    if (access.volatility === "volatile" && decision.regionMemoryType === "normalCacheable") {
      const volatileDecision: AArch64RegionMemoryTypeDecision = {
        regionMemoryType: "externalConservative",
        factsUsed: decision.factsUsed,
        explanation: [...decision.explanation, "region-memory-type:volatile-conservative"],
      };
      this.recordDecision(volatileDecision);
      return volatileDecision;
    }
    return decision;
  }

  private materializeAddressForAccess(
    label: string,
    access: OptIrMemoryAccessDescriptor,
    regionMemoryType: AArch64RegionMemoryType,
  ):
    | ({ readonly kind: "ok" } & AArch64MaterializedMemoryAddress)
    | { readonly kind: "error"; readonly stableDetail: string } {
    const decision = this.context.regionAddressBasisForRegion?.(access.region);
    const fallbackMode = selectAArch64AddressingMode({
      byteOffset: access.byteOffset,
      scale: access.byteWidth,
    });
    if (decision?.kind === "error") {
      return {
        kind: "error",
        stableDetail: `${decision.stableDetail}:operation:${String(this.operation.operationId)}`,
      };
    }
    if (decision?.kind !== "ok") {
      if (regionMemoryType === "validatedPayload") {
        return {
          kind: "error",
          stableDetail: `region-address-basis:missing-validated-payload:${String(access.region)}:operation:${String(this.operation.operationId)}`,
        };
      }
      if (fallbackMode === "base-unsigned-immediate") {
        return {
          kind: "ok",
          base: {
            kind: "register",
            register: this.materializeAddress(`${label}:absolute-base`, 0n),
          },
          offset: access.byteOffset,
          mode: fallbackMode,
        };
      }
      return {
        kind: "ok",
        base: {
          kind: "register",
          register: this.materializeAddress(`${label}:absolute-offset`, access.byteOffset),
        },
        mode: "materialized-address",
      };
    }
    this.recordDecision(decision);
    const resolvedBasis = this.resolveMemoryAddressBasis(decision.addressBasis, new Set());
    if (resolvedBasis.kind === "error") {
      return {
        kind: "error",
        stableDetail: `${resolvedBasis.stableDetail}:operation:${String(this.operation.operationId)}`,
      };
    }
    const totalOffset = resolvedBasis.byteOffset + access.byteOffset;
    const selectedMode = selectAArch64AddressingMode({
      byteOffset: totalOffset,
      scale: access.byteWidth,
    });
    if (selectedMode === "base-unsigned-immediate") {
      if (resolvedBasis.kind === "base") {
        return {
          kind: "ok",
          base: resolvedBasis.base,
          offset: totalOffset,
          mode: selectedMode,
        };
      }
      if (resolvedBasis.kind === "symbol") {
        return {
          kind: "ok",
          base: {
            kind: "register",
            register: this.materializeSymbolAddress(
              `${label}:${regionAddressBasisStableKey(decision.addressBasis)}:base`,
              resolvedBasis.symbol,
            ),
          },
          offset: totalOffset,
          mode: selectedMode,
        };
      }
      return {
        kind: "ok",
        base: {
          kind: "register",
          register: this.materializeAddress(
            `${label}:${regionAddressBasisStableKey(decision.addressBasis)}:base`,
            resolvedBasis.abstractBase,
          ),
        },
        offset: totalOffset,
        mode: selectedMode,
      };
    }
    if (resolvedBasis.kind === "base") {
      if (resolvedBasis.base.kind === "frameObject") {
        return {
          kind: "ok",
          base: {
            kind: "register",
            register: this.materializeFrameObjectAddress(
              `${label}:${regionAddressBasisStableKey(decision.addressBasis)}`,
              resolvedBasis.base.frameObject,
              totalOffset,
            ),
          },
          mode: "materialized-address",
        };
      }
      const addressRegister = this.syntheticRegister(
        `${label}:${regionAddressBasisStableKey(decision.addressBasis)}:effective-address`,
        POINTER,
      );
      this.materializeOffsetAdd(addressRegister, resolvedBasis.base.register, totalOffset, label);
      return {
        kind: "ok",
        base: { kind: "register", register: addressRegister },
        mode: "materialized-address",
      };
    }
    if (resolvedBasis.kind === "symbol") {
      const symbolBase = this.materializeSymbolAddress(
        `${label}:${regionAddressBasisStableKey(decision.addressBasis)}:base`,
        resolvedBasis.symbol,
      );
      const addressRegister = this.syntheticRegister(
        `${label}:${regionAddressBasisStableKey(decision.addressBasis)}:symbol-effective-address`,
        POINTER,
      );
      this.materializeOffsetAdd(addressRegister, symbolBase, totalOffset, label);
      return {
        kind: "ok",
        base: { kind: "register", register: addressRegister },
        mode: "materialized-address",
      };
    }
    return {
      kind: "ok",
      base: {
        kind: "register",
        register: this.materializeAddress(
          `${label}:${regionAddressBasisStableKey(decision.addressBasis)}`,
          resolvedBasis.abstractBase + totalOffset,
        ),
      },
      mode: "materialized-address",
    };
  }

  private memoryAddressOperands(
    address: AArch64MaterializedMemoryAddress,
  ): readonly AArch64InstructionOperand[] {
    return this.memoryBaseOperandWithOptionalOffset(address.base, address.offset);
  }

  private memoryAddressOperandsForOpcode(
    opcode: string,
    address: AArch64MaterializedMemoryAddress,
    label: string,
  ):
    | { readonly kind: "ok"; readonly operands: readonly AArch64InstructionOperand[] }
    | { readonly kind: "error"; readonly stableDetail: string } {
    if (!isBaseOnlyMemoryOpcode(opcode)) {
      return { kind: "ok", operands: this.memoryAddressOperands(address) };
    }
    if (
      address.base.kind === "frameObject" &&
      (address.offset === undefined || address.offset === 0n)
    ) {
      return { kind: "ok", operands: this.memoryBaseOperandWithOptionalOffset(address.base) };
    }
    const baseRegister = this.baseOnlyMemoryAddressRegister(address, label);
    if (baseRegister.kind === "error") {
      return baseRegister;
    }
    return {
      kind: "ok",
      operands: this.memoryBaseOperandWithOptionalOffset({
        kind: "register",
        register: baseRegister.register,
      }),
    };
  }

  private baseOnlyMemoryAddressRegister(
    address: AArch64MaterializedMemoryAddress,
    label: string,
  ):
    | { readonly kind: "ok"; readonly register: AArch64VirtualRegister }
    | { readonly kind: "error"; readonly stableDetail: string } {
    if (address.offset === undefined || address.offset === 0n) {
      if (address.base.kind === "register") {
        return { kind: "ok", register: address.base.register };
      }
      return {
        kind: "ok",
        register: this.materializeFrameObjectAddress(label, address.base.frameObject, 0n),
      };
    }
    if (address.base.kind === "frameObject") {
      return {
        kind: "ok",
        register: this.materializeFrameObjectAddress(
          label,
          address.base.frameObject,
          address.offset,
        ),
      };
    }
    const effectiveAddress = this.syntheticRegister(`${label}:ordered-effective-address`, POINTER);
    this.materializeOffsetAdd(effectiveAddress, address.base.register, address.offset, label);
    return { kind: "ok", register: effectiveAddress };
  }

  private memoryBaseOperandWithOptionalOffset(
    base: AArch64MaterializedMemoryBase,
    offset?: bigint,
  ): readonly AArch64InstructionOperand[] {
    const type = base.kind === "register" ? base.register.type : POINTER;
    const baseOperand = aarch64InstructionOperand({
      role: "memoryBase",
      operand:
        base.kind === "register"
          ? { kind: "vreg", register: base.register }
          : { kind: "frameObject", frameObject: base.frameObject },
      type,
    });
    if (offset === undefined || offset === 0n) {
      return [baseOperand];
    }
    return [baseOperand, immediateOperand(offset, POINTER)];
  }

  private resolveMemoryAddressBasis(
    addressBasis: AArch64RegionAddressBasis,
    visitedRegions: Set<number>,
  ): AArch64ResolvedMemoryAddressBasis | { readonly kind: "error"; readonly stableDetail: string } {
    if (addressBasis.kind === "frameObject") {
      return {
        kind: "base",
        base: { kind: "frameObject", frameObject: addressBasis.object },
        byteOffset: 0n,
      };
    }
    if (addressBasis.kind === "derivedRegionBase") {
      const backingRegion = Number(addressBasis.backingRegion);
      if (visitedRegions.has(backingRegion)) {
        return { kind: "error", stableDetail: `region-address-basis:cycle:${backingRegion}` };
      }
      visitedRegions.add(backingRegion);
      const backingDecision = this.context.regionAddressBasisForRegion?.(
        addressBasis.backingRegion,
      );
      if (backingDecision?.kind === "error") {
        return backingDecision;
      }
      if (backingDecision?.kind === "ok") {
        this.recordDecision(backingDecision);
        const backingBasis = this.resolveMemoryAddressBasis(
          backingDecision.addressBasis,
          visitedRegions,
        );
        return backingBasis.kind === "error"
          ? backingBasis
          : addResolvedMemoryAddressBasisOffset(backingBasis, addressBasis.byteOffset);
      }
      return {
        kind: "abstract",
        abstractBase: abstractAddressBaseForKey(`region:${String(addressBasis.backingRegion)}`),
        byteOffset: addressBasis.byteOffset,
      };
    }
    if (addressBasis.kind === "globalSymbol") {
      return { kind: "symbol", symbol: addressBasis.symbol, byteOffset: 0n };
    }
    if (addressBasis.kind === "deviceMmioBase") {
      return { kind: "symbol", symbol: addressBasis.base, byteOffset: 0n };
    }
    if (addressBasis.kind === "firmwareTableBase") {
      return {
        kind: "symbol",
        symbol: symbolicExternalRegionBase(addressBasis.base),
        byteOffset: 0n,
      };
    }
    if (addressBasis.kind === "runtimeOwned") {
      return {
        kind: "symbol",
        symbol: symbolicExternalRegionBase(addressBasis.base),
        byteOffset: 0n,
      };
    }
    return {
      kind: "abstract",
      abstractBase: abstractAddressBaseForKey(regionAddressBasisStableKey(addressBasis)),
      byteOffset: 0n,
    };
  }

  private materializeAddress(label: string, address: bigint): AArch64VirtualRegister {
    const register = this.syntheticRegister(label, POINTER);
    this.emitValueConstant(register, address);
    return register;
  }

  private materializeSymbolAddress(
    label: string,
    symbol: AArch64SymbolReference,
  ): AArch64VirtualRegister {
    const pageRegister = this.syntheticRegister(`${label}:symbol-page`, POINTER);
    const addressRegister = this.syntheticRegister(`${label}:symbol-pageoff`, POINTER);
    this.recordSymbolAddressRelocations(symbol.symbol, "aarch64-relocation:region-address");
    this.emit(
      "adrp",
      [defVreg(pageRegister, pageRegister.type), symbolOperand(symbol.symbol)],
      { mayTrap: false },
      `${label}:adrp`,
      "integer",
    );
    this.emit(
      "add-pageoff",
      [
        defVreg(addressRegister, addressRegister.type),
        useVreg(pageRegister, pageRegister.type),
        immediateOperand(0n, addressRegister.type),
        symbolOperand(symbol.symbol),
      ],
      { mayTrap: false },
      `${label}:pageoff`,
      "integer",
    );
    return addressRegister;
  }

  private materializeFrameObjectAddress(
    label: string,
    frameObject: AArch64FrameObjectId,
    offset: bigint,
  ): AArch64VirtualRegister {
    const register = this.syntheticRegister(`${label}:frame-address`, POINTER);
    this.emit(
      "frame-address",
      [
        defVreg(register, register.type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "frameObject", frameObject },
          type: POINTER,
        }),
        immediateOperand(offset, POINTER),
      ],
      { mayTrap: false },
      label,
    );
    return register;
  }
}

function symbolicExternalRegionBase(base: string): AArch64SymbolReference {
  return aarch64SymbolReference({
    symbol: aarch64SymbolId(base),
    visibility: "external",
  });
}
