import type {
  OptIrConstantId,
  OptIrFactId,
  OptIrRegionId,
  OptIrValueId,
} from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import type { AArch64FactQuery } from "../facts/aarch64-fact-query";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import {
  aarch64MemoryOrderingMetadata,
  type AArch64RegionMemoryType,
} from "../machine-ir/memory-order";
import {
  aarch64InstructionOperand,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  useVreg,
} from "../machine-ir/operands";
import type { AArch64RelocationReference } from "../machine-ir/relocation-reference";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import { selectAArch64EndianDecode } from "../select/endian-selection";
import type { AArch64FpEnvironmentPolicy } from "../select/fp-selection";
import { selectAArch64VectorOperation } from "../select/vector-selection";
import { aarch64OperationSupportForKind } from "../target-surface/operation-matrix";
import type { AArch64AbiTargetSurface } from "../target-surface/target-surface";
import type { AArch64FirmwareLoweringContext } from "./firmware-platform-call-contract";
import {
  classifierOpcodeForContract,
  factBigInt,
  fieldPathStableKey,
  isAggregateOperation,
  isCallOperation,
  semanticAtomicContract,
  unsupportedAggregateLowering,
  unsupportedEnumLowering,
  validateThreeRegisterOpcodeClasses,
  type SemanticOptIrOperation,
} from "./materialization-contracts";
import { lowerAArch64MemoryOrder } from "./memory-order-lowering";
import {
  asAArch64MemoryOrder,
  conditionForCompareOperator,
  endianDecodeWidthBits,
  GPR64,
  opcodeForIntegerBinary,
  patternIdForOperation,
  selectionTierForOperation,
  type OperationOf,
  type SourceValueOperation,
  vectorOperationKind,
} from "./operation-materialization-helpers";
import type {
  AArch64LoweringSelectionRecord,
  AArch64OperationSupportContract,
} from "./pipeline-stages";
import type { AArch64RegionAddressBasisDecision } from "./region-lowering";
import { AArch64CallOperationMaterializer } from "./operation-materializer-calls";
import {
  materializeAArch64ConstAddrOperation,
  type AArch64StaticReadonlyPointer,
} from "./operation-materializer-const-addr";
import { materializeAArch64FpNumericOperation } from "./operation-materializer-fp-numeric";

export {
  machineTypeForOptIrType,
  registerClassForMachineType,
  virtualRegisterForOptIrValue,
} from "./operation-materialization-helpers";

export type AArch64OperationMaterializationResult =
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64MachineInstruction[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly relocationReferences: readonly AArch64RelocationReference[];
      readonly selectionRecord: AArch64LoweringSelectionRecord;
    }
  | { readonly kind: "error"; readonly stableDetail: string };

export interface AArch64OperationMaterializationInput {
  readonly operation: OptIrOperation;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly context?: AArch64OperationMaterializationContext;
}

export interface AArch64OperationMaterializationContext {
  readonly abi?: AArch64AbiTargetSurface;
  readonly fpEnvironment?: AArch64FpEnvironmentPolicy;
  readonly factQuery?: AArch64FactQuery;
  readonly operationSupportContracts?: ReadonlyMap<number, AArch64OperationSupportContract>;
  readonly firmware?: AArch64FirmwareLoweringContext;
  readonly staticReadonlyPointers?: ReadonlyMap<OptIrConstantId, AArch64StaticReadonlyPointer>;
  readonly regionAddressBasisForRegion?: (
    regionId: OptIrRegionId,
  ) => AArch64RegionAddressBasisDecision | undefined;
  readonly regionMemoryTypeForRegion?: (regionId: OptIrRegionId) => AArch64RegionMemoryTypeDecision;
  readonly vectorPolicyForOperation?: (
    operation: OptIrOperation,
  ) => AArch64VectorPolicyDecision | undefined;
  readonly relocationTargetFingerprint?: string;
}

export interface AArch64RegionMemoryTypeDecision {
  readonly regionMemoryType: AArch64RegionMemoryType;
  readonly factsUsed: readonly OptIrFactId[];
  readonly explanation: readonly string[];
}

export interface AArch64VectorPolicyDecision {
  readonly policy: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
  readonly factsUsed: readonly OptIrFactId[];
  readonly explanation: readonly string[];
}

export function materializeAArch64OptIrOperation(
  input: AArch64OperationMaterializationInput,
): AArch64OperationMaterializationResult {
  const materializer = new OperationMaterializer(
    input.operation,
    input.valueRegisters,
    input.context,
  );
  const result = materializer.materialize();
  if (result.kind === "error") {
    return result;
  }
  return {
    kind: "ok",
    instructions: result.instructions,
    virtualRegisters: result.virtualRegisters,
    relocationReferences: result.relocationReferences,
    selectionRecord: {
      stageKey: "lower-function-shells",
      subjectKey: `operation:${String(input.operation.operationId)}`,
      patternId: patternIdForOperation(input.operation),
      tier: selectionTierForOperation(input.operation),
      coveredOperationIds: [Number(input.operation.operationId)],
      factsUsed: result.factsUsed.map((factId) => Number(factId)),
      emittedOpcodes: result.instructions.map((instruction) => String(instruction.opcode)),
      emittedInstructionIds: result.instructions.map((instruction) => instruction.instructionId),
      explanation: [
        `lower-function-shells:materialized:${String(input.operation.operationId)}:${input.operation.kind}`,
        ...result.explanation,
      ],
    },
  };
}

class OperationMaterializer extends AArch64CallOperationMaterializer {
  constructor(
    operation: OptIrOperation,
    valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>,
    context: AArch64OperationMaterializationContext | undefined,
  ) {
    super(operation, valueRegisters, context);
  }

  materialize():
    | {
        readonly kind: "ok";
        readonly instructions: readonly AArch64MachineInstruction[];
        readonly virtualRegisters: readonly AArch64VirtualRegister[];
        readonly relocationReferences: readonly AArch64RelocationReference[];
        readonly factsUsed: readonly OptIrFactId[];
        readonly explanation: readonly string[];
      }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const operationSupport = this.verifyOperationSupport();
    if (operationSupport.kind === "error") {
      return operationSupport;
    }
    const result = this.materializeOperation();
    if (result.kind === "error") {
      return result;
    }
    return {
      kind: "ok",
      ...this.materializationResult(),
    };
  }

  private verifyOperationSupport():
    | { readonly kind: "ok" }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const contract = this.context.operationSupportContracts?.get(
      Number(this.operation.operationId),
    );
    if (contract !== undefined) {
      contract.factsUsed.forEach((factId) => this.factsUsed.add(factId as OptIrFactId));
      this.explanation.push(...contract.explanation);
      return { kind: "ok" };
    }
    const support = aarch64OperationSupportForKind(this.operation.kind);
    if (support.status === "required") {
      this.explanation.push(`operation-matrix:required:${this.operation.kind}`);
      return { kind: "ok" };
    }
    if (
      support.status === "fact-gated" &&
      (this.operation.kind === "memoryLoad" || this.operation.kind === "memoryStore")
    ) {
      this.explanation.push(`operation-matrix:fact-gated:fallback:${support.fallback}`);
      return { kind: "ok" };
    }
    if (support.status === "helper-lowered" && isCallOperation(this.operation)) {
      this.explanation.push(
        `operation-matrix:helper-lowered:standalone-call:${support.catalogRequirement}`,
      );
      return { kind: "ok" };
    }
    if (
      support.status === "unsupported-until-layout-lowering" &&
      isAggregateOperation(this.operation)
    ) {
      return { kind: "ok" };
    }
    return {
      kind: "error",
      stableDetail: `operation-matrix:materialize:missing-authorization:${String(this.operation.operationId)}:${this.operation.kind}:${support.status}`,
    };
  }

  private materializeOperation():
    | { readonly kind: "ok" }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const operation = this.operation;
    switch (operation.kind) {
      case "constant":
        this.emitValueConstant(
          this.resultRegister(operation, 0),
          operation.constant.normalizedValue,
        );
        return { kind: "ok" };
      case "constAddr":
        return this.materializeConstAddr(operation);
      case "integerUnary":
        return this.materializeIntegerUnary(operation);
      case "integerBinary":
        return this.materializeIntegerBinary(operation);
      case "integerCompare":
        return this.materializeIntegerCompare(operation);
      case "booleanNot":
        return this.materializeBooleanNot(operation);
      case "booleanBinary":
        return this.materializeBooleanBinary(operation);
      case "aggregateConstruct":
        return unsupportedAggregateLowering(operation, "construct");
      case "aggregateExtract":
        return unsupportedAggregateLowering(
          operation,
          `extract:${fieldPathStableKey(operation.fieldPath)}`,
        );
      case "aggregateInsert":
        return unsupportedAggregateLowering(
          operation,
          `insert:${fieldPathStableKey(operation.fieldPath)}`,
        );
      case "enumTagStore":
      case "enumPayloadStore":
      case "enumTagLoad":
      case "enumPayloadLoad":
        return unsupportedEnumLowering(operation);
      case "layoutOffset":
      case "layoutByteRange":
        return this.materializeLayoutByteRangeAddress(operation);
      case "layoutEndianDecode":
        return this.materializeEndianDecode(operation);
      case "memoryLoad":
        return this.materializeMemoryLoad(operation, "ldr-unsigned-immediate", "load");
      case "memoryStore":
        return this.materializeMemoryStore(
          operation,
          "str-unsigned-immediate",
          operation.storeValue,
          "store",
        );
      case "sourceCall":
      case "runtimeCall":
      case "platformCall":
      case "intrinsicCall":
        return this.materializeCall(operation);
      case "vectorLoad":
      case "vectorMaskedLoad": {
        const opcode = this.vectorLoadOpcode(operation, "ld1");
        if (typeof opcode !== "string") return opcode;
        return this.materializeMemoryLoad(operation, opcode, "load");
      }
      case "vectorStore":
      case "vectorMaskedStore": {
        const opcode = this.vectorStoreOpcode(operation, "st1");
        if (typeof opcode !== "string") return opcode;
        return this.materializeMemoryStore(operation, opcode, operation.storeValue, "store");
      }
      case "vectorShuffle":
      case "vectorCompare":
      case "vectorSelect":
        return this.materializeVectorRegisterOperation(operation);
      case "vectorByteSwap":
        return this.materializeVectorByteSwap(operation);
      case "semanticAtomic":
        return this.materializeSemanticAtomic(operation);
      case "semanticFence":
      case "semanticRegionMarker":
        this.emitBarrier(operation.kind);
        return { kind: "ok" };
      case "semanticChecksum":
        return this.materializeThreeRegisterOperation(operation, "crc32", operation.sourceValueIds);
      case "semanticPolynomial":
        return this.materializeThreeRegisterOperation(operation, "pmull", operation.sourceValueIds);
      case "semanticCryptoMix":
        return this.materializeThreeRegisterOperation(
          operation,
          "aes-sha-round",
          operation.sourceValueIds,
        );
      case "semanticClassifier":
        return this.materializeSemanticClassifier(operation);
      case "fpNumeric":
        return this.materializeFpNumeric(operation);
      case "proofErasedMarker":
        return { kind: "ok" };
    }
  }

  private materializeConstAddr(
    operation: OperationOf<"constAddr">,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    return materializeAArch64ConstAddrOperation({
      operation,
      staticReadonlyPointers: this.context.staticReadonlyPointers,
      resultRegister: (operationToMaterialize, index) =>
        this.resultRegister(operationToMaterialize, index),
      materializeStaticReadonlyPointer: (input) => this.materializeStaticReadonlyPointer(input),
      emitCopy: (output, input, label) => this.emitCopy(output, input, label),
      recordExplanation: (message) => this.explanation.push(message),
    });
  }

  private materializeIntegerUnary(operation: OperationOf<"integerUnary">): { readonly kind: "ok" } {
    const output = this.resultRegister(operation, 0);
    const operand = this.valueRegister(operation.operand);
    if (operation.operator === "negate") {
      const zero = this.syntheticRegister("integer-unary-zero", GPR64);
      this.emitValueConstant(zero, 0n);
      this.emit(
        "sub-shifted-register",
        [defVreg(output, output.type), useVreg(zero, zero.type), useVreg(operand, operand.type)],
        { mayTrap: false },
      );
      return { kind: "ok" };
    }
    const mask = this.syntheticRegister("integer-unary-not-mask", output.type);
    this.emitValueConstant(mask, -1n);
    this.emit(
      "eor-shifted-register",
      [defVreg(output, output.type), useVreg(operand, operand.type), useVreg(mask, mask.type)],
      { mayTrap: false },
    );
    return { kind: "ok" };
  }

  private materializeIntegerBinary(operation: OperationOf<"integerBinary">): {
    readonly kind: "ok";
  } {
    const opcode = opcodeForIntegerBinary(operation);
    const output = this.resultRegister(operation, 0);
    const left = this.valueRegister(operation.left);
    const right = this.valueRegister(operation.right);
    this.emit(
      opcode,
      [defVreg(output, output.type), useVreg(left, left.type), useVreg(right, right.type)],
      { mayTrap: operation.operator === "unsignedDivide" || operation.operator === "signedDivide" },
    );
    return { kind: "ok" };
  }

  private materializeIntegerCompare(operation: OperationOf<"integerCompare">): {
    readonly kind: "ok";
  } {
    const output = this.resultRegister(operation, 0);
    const left = this.valueRegister(operation.left);
    const right = this.valueRegister(operation.right);
    this.emit(
      "cmp-shifted-register",
      [useVreg(left, left.type), useVreg(right, right.type), implicitDefResource({ kind: "NZCV" })],
      { mayTrap: false },
    );
    this.emit(
      "cset",
      [
        defVreg(output, output.type),
        implicitUseResource({ kind: "NZCV" }),
        immediateOperand(conditionForCompareOperator(operation.operator), GPR64),
      ],
      { mayTrap: false },
    );
    return { kind: "ok" };
  }

  private materializeBooleanNot(operation: OperationOf<"booleanNot">): { readonly kind: "ok" } {
    const output = this.resultRegister(operation, 0);
    const operand = this.valueRegister(operation.operand);
    this.emit(
      "eor-logical-immediate",
      [
        defVreg(output, output.type),
        useVreg(operand, operand.type),
        immediateOperand(1n, output.type),
      ],
      { mayTrap: false },
    );
    return { kind: "ok" };
  }

  private materializeBooleanBinary(operation: OperationOf<"booleanBinary">): {
    readonly kind: "ok";
  } {
    const output = this.resultRegister(operation, 0);
    const left = this.valueRegister(operation.left);
    const right = this.valueRegister(operation.right);
    if (operation.operator === "equal" || operation.operator === "notEqual") {
      const xorResult =
        operation.operator === "notEqual"
          ? output
          : this.syntheticRegister("bool-xor", output.type);
      this.emit(
        "eor-shifted-register",
        [defVreg(xorResult, xorResult.type), useVreg(left, left.type), useVreg(right, right.type)],
        { mayTrap: false },
      );
      if (operation.operator === "equal") {
        this.emit(
          "eor-logical-immediate",
          [
            defVreg(output, output.type),
            useVreg(xorResult, xorResult.type),
            immediateOperand(1n, output.type),
          ],
          { mayTrap: false },
        );
      }
      return { kind: "ok" };
    }
    const opcode = operation.operator === "or" ? "orr-shifted-register" : "and-shifted-register";
    this.emit(
      opcode,
      [defVreg(output, output.type), useVreg(left, left.type), useVreg(right, right.type)],
      { mayTrap: false },
    );
    return { kind: "ok" };
  }

  private materializeEndianDecode(operation: OperationOf<"layoutEndianDecode">): {
    readonly kind: "ok";
  } {
    const output = this.resultRegister(operation, 0);
    const bytes = this.valueRegister(operation.bytes);
    const selection = selectAArch64EndianDecode({
      endian: operation.endian,
      widthBits: endianDecodeWidthBits(output.type),
    });
    this.explanation.push(`endian-selection:${operation.endian}:${selection.opcode}`);
    if (selection.opcode !== "identity") {
      this.emit(selection.opcode, [defVreg(output, output.type), useVreg(bytes, bytes.type)], {
        mayTrap: false,
      });
      return { kind: "ok" };
    }
    this.emit(
      "add-immediate",
      [defVreg(output, output.type), useVreg(bytes, bytes.type), immediateOperand(0n, output.type)],
      { mayTrap: false },
    );
    return { kind: "ok" };
  }

  private materializeLayoutByteRangeAddress(
    operation: OperationOf<"layoutOffset" | "layoutByteRange">,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const answer = this.context.factQuery?.layoutByteRangeForKey(operation.layoutPath);
    if (answer === undefined || answer.kind !== "yes") {
      return {
        kind: "error",
        stableDetail: `layout-lowering:missing-byte-range-fact:${String(operation.operationId)}:${operation.kind}:${String(operation.layoutPath)}`,
      };
    }
    this.recordFactAnswer(answer);
    const offsetBytes = factBigInt(answer.offsetBytes);
    const sizeBytes = factBigInt(answer.sizeBytes);
    if (
      offsetBytes === undefined ||
      offsetBytes < 0n ||
      sizeBytes === undefined ||
      sizeBytes <= 0n
    ) {
      return {
        kind: "error",
        stableDetail: `layout-lowering:malformed-byte-range-fact:${String(operation.operationId)}:${operation.kind}:${String(operation.layoutPath)}`,
      };
    }
    return this.materializeOffsetAdd(
      this.resultRegister(operation, 0),
      this.valueRegister(operation.base),
      offsetBytes,
      `${operation.kind}:${String(operation.layoutPath)}`,
    );
  }

  private copyFirstAvailableValue(
    operation: OptIrOperation,
    values: readonly OptIrValueId[],
    label: string,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const output = this.resultRegister(operation, 0);
    if (output.type.kind === "vector") {
      return {
        kind: "error",
        stableDetail: `vector-copy-helper-required:${String(operation.operationId)}:${label}`,
      };
    }
    const sourceValue = values[0];
    if (sourceValue === undefined) {
      this.emitValueConstant(output, 0n);
      return { kind: "ok" };
    }
    const sourceRegister = this.valueRegister(sourceValue);
    this.emit(
      "add-immediate",
      [
        defVreg(output, output.type),
        useVreg(sourceRegister, sourceRegister.type),
        immediateOperand(0n, output.type),
      ],
      { mayTrap: false },
      label,
    );
    return { kind: "ok" };
  }

  private vectorLoadOpcode(
    operation: OptIrOperation,
    directOpcode: "ld1",
  ): "ld1" | { readonly kind: "error"; readonly stableDetail: string } {
    return this.vectorOpcode(operation, "load", directOpcode) as
      | "ld1"
      | { readonly kind: "error"; readonly stableDetail: string };
  }

  private vectorStoreOpcode(
    operation: OptIrOperation,
    directOpcode: "st1",
  ): "st1" | { readonly kind: "error"; readonly stableDetail: string } {
    return this.vectorOpcode(operation, "store", directOpcode) as
      | "st1"
      | { readonly kind: "error"; readonly stableDetail: string };
  }

  private materializeVectorRegisterOperation(
    operation: OperationOf<"vectorShuffle" | "vectorCompare" | "vectorSelect">,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    if (operation.kind === "vectorSelect") {
      return this.materializeVectorSelect(operation);
    }
    const opcode = this.vectorOpcode(operation, vectorOperationKind(operation.kind), "tbl");
    if (typeof opcode !== "string") {
      return opcode;
    }
    return this.materializeThreeRegisterOperation(
      operation,
      opcode as "tbl" | "tbx" | "cmeq",
      operation.sourceValueIds,
    );
  }

  private materializeVectorSelect(
    operation: OperationOf<"vectorSelect">,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const opcode = this.vectorOpcode(operation, "select", "bsl");
    if (typeof opcode !== "string") {
      return opcode;
    }
    const output = this.resultRegister(operation, 0);
    const mask = this.valueRegister(operation.mask);
    const ifTrue = this.sourceRegisterAt(operation.sourceValueIds, 0);
    if (ifTrue.kind === "error") return ifTrue;
    const ifFalse = this.sourceRegisterAt(operation.sourceValueIds, 1);
    if (ifFalse.kind === "error") return ifFalse;
    this.emit(
      "bsl",
      [
        defVreg(output, output.type),
        useVreg(mask, mask.type),
        useVreg(ifTrue.register, ifTrue.register.type),
        useVreg(ifFalse.register, ifFalse.register.type),
      ],
      { mayTrap: false },
      operation.kind,
    );
    return { kind: "ok" };
  }

  private vectorOpcode(
    operation: OptIrOperation,
    operationKind: "load" | "store" | "shuffle" | "compare" | "select" | "byteSwap",
    directOpcode: string,
  ): string | { readonly kind: "error"; readonly stableDetail: string } {
    const decision = this.context.vectorPolicyForOperation?.(operation) ?? {
      policy: "ownsVectorState" as const,
      factsUsed: [],
      explanation: [`vector-policy:default-owns-vector-state:${String(operation.operationId)}`],
    };
    this.recordDecision(decision);
    const selection = selectAArch64VectorOperation({
      policy: decision.policy,
      operationKind,
    });
    this.explanation.push(
      ...selection.rejectedAlternatives.map(
        (alternative) => `vector-rejected:${alternative.patternId}:${alternative.reason}`,
      ),
    );
    const selectedOpcode = selection.instructions[0];
    if (selectedOpcode === "scalar-helper" || selectedOpcode === "vector-helper") {
      this.explanation.push(`vector-selection:${selectedOpcode}:${operationKind}`);
      return {
        kind: "error",
        stableDetail: `vector-helper-lowering-required:${String(operation.operationId)}:${selectedOpcode}:${operationKind}`,
      };
    }
    const opcode = selectedOpcode ?? directOpcode;
    this.explanation.push(`vector-selection:direct:${operationKind}:${opcode}`);
    return opcode;
  }

  private materializeSemanticAtomic(
    operation: SemanticOptIrOperation,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const contract = semanticAtomicContract(operation);
    if (contract.kind === "error") return contract;
    const orderAnswer = this.context.factQuery?.memoryOrderForOperation(operation.operationId);
    if (orderAnswer !== undefined) {
      this.recordFactAnswer(orderAnswer);
    }
    if (orderAnswer?.kind !== "yes") {
      return {
        kind: "error",
        stableDetail: `semantic-atomic:missing-memory-order:${String(operation.operationId)}`,
      };
    }
    const order = asAArch64MemoryOrder(orderAnswer.order);
    if (order === undefined) {
      return {
        kind: "error",
        stableDetail: `semantic-atomic:unsupported-memory-order:${String(operation.operationId)}:${orderAnswer.order}`,
      };
    }
    const lowered = lowerAArch64MemoryOrder({
      accessKind: "readModifyWrite",
      order,
      regionMemoryType: contract.regionMemoryType,
    });
    if (lowered.kind === "error") {
      return {
        kind: "error",
        stableDetail: `${lowered.reason}:operation:${String(operation.operationId)}`,
      };
    }
    const opcode = lowered.instructions.find(
      (instruction): instruction is "ldadd" | "ldadda" | "ldaddl" | "ldaddal" =>
        instruction === "ldadd" ||
        instruction === "ldadda" ||
        instruction === "ldaddl" ||
        instruction === "ldaddal",
    );
    if (opcode === undefined) {
      return {
        kind: "error",
        stableDetail: `semantic-atomic:missing-lse-opcode:${String(operation.operationId)}`,
      };
    }
    const address = this.sourceRegisterAt(operation.sourceValueIds, contract.addressSourceIndex);
    if (address.kind === "error") return address;
    const input = this.sourceRegisterAt(operation.sourceValueIds, contract.valueSourceIndex);
    if (input.kind === "error") return input;
    const inputRegister = input.register;
    const output =
      operation.resultIds.length === 0
        ? this.syntheticRegister("semantic-atomic-old-value", GPR64)
        : this.resultRegister(operation, 0);
    this.emit(
      opcode,
      [
        useVreg(inputRegister, inputRegister.type),
        defVreg(output, output.type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: address.register },
          type: address.register.type,
        }),
      ],
      { mayTrap: false, mayLoad: true, mayStore: true },
      operation.kind,
      "load",
      aarch64MemoryOrderingMetadata({
        order,
        regionMemoryType: contract.regionMemoryType,
        barrierDomain: { domain: "system", access: "loadsAndStores" },
        atomicity: "lseAtomic",
      }),
    );
    return { kind: "ok" };
  }

  private materializeThreeRegisterOperation(
    operation: SourceValueOperation,
    opcode: "tbl" | "tbx" | "cmeq" | "crc32" | "pmull" | "aes-sha-round" | "dotprod",
    sourceValueIds: readonly OptIrValueId[],
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const output =
      operation.resultIds.length === 0
        ? this.syntheticRegister(`${opcode}-discard`, GPR64)
        : this.resultRegister(operation, 0);
    const left = this.sourceRegisterAt(sourceValueIds, 0);
    if (left.kind === "error") return left;
    const right = this.sourceRegisterAt(sourceValueIds, 1);
    if (right.kind === "error") return right;
    const classValidation = validateThreeRegisterOpcodeClasses(opcode, [
      output,
      left.register,
      right.register,
    ]);
    if (classValidation.kind === "error") {
      return {
        kind: "error",
        stableDetail: `three-register-lowering:register-class-mismatch:${String(operation.operationId)}:${opcode}:${classValidation.operandIndex}:${classValidation.expected}:${classValidation.actual}`,
      };
    }
    this.emit(
      opcode,
      [
        defVreg(output, output.type),
        useVreg(left.register, left.register.type),
        useVreg(right.register, right.register.type),
      ],
      { mayTrap: false },
      operation.kind,
    );
    return { kind: "ok" };
  }

  private materializeSemanticClassifier(
    operation: SemanticOptIrOperation,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const decision = this.context.vectorPolicyForOperation?.(operation) ?? {
      policy: "ownsVectorState" as const,
      factsUsed: [],
      explanation: [`vector-policy:default-owns-vector-state:${String(operation.operationId)}`],
    };
    this.recordDecision(decision);
    if (decision.policy !== "ownsVectorState") {
      this.explanation.push(`classifier-selection:${decision.policy}:helper-fallback`);
      return this.copyFirstAvailableValue(
        operation,
        operation.sourceValueIds,
        "classifier.helper-fallback",
      );
    }
    const opcode = classifierOpcodeForContract(operation.semanticContract.tableShape);
    if (opcode === undefined) {
      return {
        kind: "error",
        stableDetail: `semantic-classifier:unsupported-table-shape:${String(operation.operationId)}`,
      };
    }
    return this.materializeThreeRegisterOperation(operation, opcode, operation.sourceValueIds);
  }

  private materializeVectorByteSwap(
    operation: OperationOf<"vectorByteSwap">,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    const output = this.resultRegister(operation, 0);
    const vector = this.valueRegister(operation.vector);
    const opcode = this.vectorOpcode(operation, "byteSwap", "rev16");
    if (typeof opcode !== "string") {
      return opcode;
    }
    this.emit(
      opcode,
      opcode === "add-immediate"
        ? [
            defVreg(output, output.type),
            useVreg(vector, vector.type),
            immediateOperand(0n, output.type),
          ]
        : [defVreg(output, output.type), useVreg(vector, vector.type)],
      { mayTrap: false },
      operation.kind,
    );
    return { kind: "ok" };
  }

  private materializeFpNumeric(
    operation: OperationOf<"fpNumeric">,
  ): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
    return materializeAArch64FpNumericOperation({
      operation,
      fpContractionForOperation: (operationId) =>
        this.context.factQuery?.fpContractionForOperation(operationId),
      fpEnvironment: this.context.fpEnvironment,
      vectorPolicyForOperation: (operationToMaterialize) =>
        this.context.vectorPolicyForOperation?.(operationToMaterialize),
      syntheticRegister: (label, type) => this.syntheticRegister(label, type),
      resultRegister: (operationToMaterialize, index) =>
        this.resultRegister(operationToMaterialize, index),
      sourceRegisterAt: (sourceValueIds, index) => this.sourceRegisterAt(sourceValueIds, index),
      recordDecision: (decision) =>
        this.recordDecision(
          decision as {
            readonly factsUsed: readonly (OptIrFactId | number)[];
            readonly explanation: readonly string[];
          },
        ),
      emit: (opcode, operands, flags, label, issueClass) =>
        this.emit(opcode, operands, flags, label, issueClass),
    });
  }

  private emitBarrier(label: string): void {
    this.emitBarrierOpcode("dmb", label);
  }
}
