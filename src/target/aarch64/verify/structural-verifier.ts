import {
  aarch64OpcodeFormById,
  type AArch64OpcodeForm,
  type AArch64OpcodeOperandSchema,
} from "../machine-ir/opcode-catalog";
import {
  aarch64MachineTypeStableKey,
  aarch64RegisterClassAcceptsType,
} from "../machine-ir/machine-types";
import { aarch64ResourceStableKey } from "../machine-ir/resources";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import {
  aarch64InstructionImmediateValueMatchesKind,
  aarch64LogicalImmediateWidth,
  isAArch64LogicalImmediate,
  isAArch64LogicalImmediateOpcode,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import type { AArch64InstructionOperand } from "../machine-ir/operands";
import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type {
  AArch64MachineVerifierDescriptor,
  AArch64MachineVerifierContext,
} from "./verifier-suite";

export const aarch64StructuralVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "structural",
  verify(context) {
    return verifyAArch64MachineStructural(context);
  },
};

export function verifyAArch64MachineStructural(
  context: AArch64MachineVerifierContext,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  const globalSymbols = new Set(context.program.globalSymbols.map((symbol) => symbol.symbol));
  if (!globalSymbols.has(context.program.entrySymbol)) {
    diagnostics.push(
      context.makeDiagnostic({
        code: "AARCH64_UNRESOLVED_SYMBOL_REFERENCE",
        ownerKey: `program:${context.program.programId}`,
        rootCauseKey: `symbol:${context.program.entrySymbol}`,
        stableDetail: `missing-entry-symbol:${context.program.entrySymbol}`,
      }),
    );
  }

  for (const func of context.program.functions.entries()) {
    diagnostics.push(...verifyFunction(context, func, globalSymbols));
  }
  return diagnostics;
}

function verifyFunction(
  context: AArch64MachineVerifierContext,
  func: AArch64MachineFunction,
  globalSymbols: ReadonlySet<unknown>,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  const blockIds = new Set(func.blocks.map((block) => block.blockId));
  const frameObjectIds = new Set(func.frameObjects.map((frameObject) => frameObject.frameObjectId));
  const declaredRegisters = new Set(func.virtualRegisters.map((register) => register.vreg));
  const abiDefinitions = abiDefinedRegisters(func);
  const instructionDefinitionsByBlock = collectInstructionDefinitionsByBlock(func);
  const dominatorsByBlock = computeBlockDominators(func);
  const seenInstructionIds = new Map<number, number>();

  const entryBlocks = func.blocks.filter((block) => block.frequency.kind === "entry");
  if (entryBlocks.length !== 1) {
    diagnostics.push(
      context.makeDiagnostic({
        code: "AARCH64_INPUT_CONTRACT_INVALID",
        ownerKey: `function:${func.functionId}`,
        rootCauseKey: `function:${func.functionId}`,
        stableDetail: `missing-entry-block:function:${func.functionId}`,
      }),
    );
  }
  if (!globalSymbols.has(func.symbol)) {
    diagnostics.push(
      context.makeDiagnostic({
        code: "AARCH64_UNRESOLVED_SYMBOL_REFERENCE",
        ownerKey: `function:${func.functionId}`,
        rootCauseKey: `symbol:${func.symbol}`,
        stableDetail: `missing-function-symbol:${func.symbol}`,
      }),
    );
  }

  for (const block of func.blocks) {
    const definedRegisters = dominatedDefinitions({
      abiDefinitions,
      instructionDefinitionsByBlock,
      dominatorsByBlock,
      blockId: block.blockId,
    });
    for (const parameter of block.parameters) {
      if (!declaredRegisters.has(parameter.vreg)) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_UNDEFINED_VIRTUAL_REGISTER",
            ownerKey: `block:${block.blockId}`,
            rootCauseKey: `vreg:${parameter.vreg}`,
            stableDetail: `undefined-block-param:${block.blockId}:${parameter.vreg}`,
          }),
        );
      }
      definedRegisters.add(parameter.vreg);
    }
    if (block.terminator === undefined) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INPUT_CONTRACT_INVALID",
          ownerKey: `block:${block.blockId}`,
          rootCauseKey: `function:${func.functionId}`,
          stableDetail: `missing-terminator:block:${block.blockId}`,
        }),
      );
    } else if (block.terminator.flags.isTerminator !== true) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INPUT_CONTRACT_INVALID",
          ownerKey: `instruction:${block.terminator.instructionId}`,
          rootCauseKey: `block:${block.blockId}`,
          stableDetail: `non-terminator-in-terminator-slot:${block.terminator.instructionId}`,
        }),
      );
    }
    for (const instruction of [
      ...block.instructions,
      ...(block.terminator === undefined ? [] : [block.terminator]),
    ]) {
      const previousBlock = seenInstructionIds.get(Number(instruction.instructionId));
      if (previousBlock !== undefined) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_INPUT_CONTRACT_INVALID",
            ownerKey: `instruction:${instruction.instructionId}`,
            rootCauseKey: `function:${func.functionId}`,
            stableDetail: `duplicate-instruction-id:${instruction.instructionId}:block:${previousBlock}:block:${block.blockId}`,
          }),
        );
      } else {
        seenInstructionIds.set(Number(instruction.instructionId), Number(block.blockId));
      }
      diagnostics.push(
        ...verifyInstructionSchema(context, instruction),
        ...verifyInstructionOperands({
          context,
          instruction,
          blockIds,
          frameObjectIds,
          declaredRegisters,
          definedRegisters,
          globalSymbols,
        }),
      );
    }
  }
  return diagnostics;
}

function collectInstructionDefinitionsByBlock(
  func: AArch64MachineFunction,
): ReadonlyMap<unknown, ReadonlySet<unknown>> {
  const definitionsByBlock = new Map<unknown, Set<unknown>>();
  for (const block of func.blocks) {
    const definitions = new Set<unknown>();
    for (const instruction of instructionsForBlock(block)) {
      for (const operand of instruction.operands) {
        if (operand.operand.kind === "vreg" && isDefRole(operand.role)) {
          definitions.add(operand.operand.register.vreg);
        }
      }
    }
    definitionsByBlock.set(block.blockId, definitions);
  }
  return definitionsByBlock;
}

function dominatedDefinitions(input: {
  readonly abiDefinitions: ReadonlySet<unknown>;
  readonly instructionDefinitionsByBlock: ReadonlyMap<unknown, ReadonlySet<unknown>>;
  readonly dominatorsByBlock: ReadonlyMap<unknown, ReadonlySet<unknown>>;
  readonly blockId: unknown;
}): Set<unknown> {
  const definitions = new Set(input.abiDefinitions);
  const dominators = input.dominatorsByBlock.get(input.blockId) ?? new Set<unknown>();
  for (const [blockId, blockDefinitions] of input.instructionDefinitionsByBlock) {
    if (blockId === input.blockId || !dominators.has(blockId)) continue;
    blockDefinitions.forEach((definition) => definitions.add(definition));
  }
  return definitions;
}

function computeBlockDominators(
  func: AArch64MachineFunction,
): ReadonlyMap<unknown, ReadonlySet<unknown>> {
  const blockIds = new Set<unknown>(func.blocks.map((block) => block.blockId));
  const entryBlocks = func.blocks.filter((block) => block.frequency.kind === "entry");
  if (entryBlocks.length !== 1) {
    return selfDominators(blockIds);
  }
  const entryBlockId = entryBlocks[0]?.blockId;
  if (entryBlockId === undefined) {
    return selfDominators(blockIds);
  }
  const predecessors = computeBlockPredecessors(func, blockIds);
  const dominators = new Map<unknown, Set<unknown>>();
  for (const blockId of blockIds) {
    dominators.set(blockId, blockId === entryBlockId ? new Set([blockId]) : new Set(blockIds));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const blockId of blockIds) {
      if (blockId === entryBlockId) continue;
      const predecessorIds = predecessors.get(blockId) ?? new Set<unknown>();
      const next = new Set<unknown>([blockId]);
      if (predecessorIds.size > 0) {
        intersectPredecessorDominators(predecessorIds, dominators).forEach((dominator) =>
          next.add(dominator),
        );
      }
      const prior = dominators.get(blockId) ?? new Set<unknown>();
      if (!setsEqual(prior, next)) {
        dominators.set(blockId, next);
        changed = true;
      }
    }
  }
  return dominators;
}

function computeBlockPredecessors(
  func: AArch64MachineFunction,
  blockIds: ReadonlySet<unknown>,
): ReadonlyMap<unknown, ReadonlySet<unknown>> {
  const predecessors = new Map<unknown, Set<unknown>>();
  for (const blockId of blockIds) {
    predecessors.set(blockId, new Set());
  }
  for (const block of func.blocks) {
    for (const instruction of instructionsForBlock(block)) {
      for (const operand of instruction.operands) {
        if (operand.role !== "branchTarget" || operand.operand.kind !== "block") continue;
        if (!blockIds.has(operand.operand.block)) continue;
        predecessors.get(operand.operand.block)?.add(block.blockId);
      }
    }
  }
  return predecessors;
}

function intersectPredecessorDominators(
  predecessorIds: ReadonlySet<unknown>,
  dominators: ReadonlyMap<unknown, ReadonlySet<unknown>>,
): Set<unknown> {
  const [first, ...rest] = [...predecessorIds];
  const intersection = new Set(first === undefined ? [] : (dominators.get(first) ?? []));
  for (const predecessorId of rest) {
    const predecessorDominators = dominators.get(predecessorId) ?? new Set<unknown>();
    for (const blockId of intersection) {
      if (!predecessorDominators.has(blockId)) {
        intersection.delete(blockId);
      }
    }
  }
  return intersection;
}

function selfDominators(
  blockIds: ReadonlySet<unknown>,
): ReadonlyMap<unknown, ReadonlySet<unknown>> {
  const dominators = new Map<unknown, Set<unknown>>();
  for (const blockId of blockIds) {
    dominators.set(blockId, new Set([blockId]));
  }
  return dominators;
}

function setsEqual(left: ReadonlySet<unknown>, right: ReadonlySet<unknown>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function instructionsForBlock(
  block: AArch64MachineFunction["blocks"][number],
): readonly AArch64MachineInstruction[] {
  return [...block.instructions, ...(block.terminator === undefined ? [] : [block.terminator])];
}

function verifyInstructionSchema(
  context: AArch64MachineVerifierContext,
  instruction: AArch64MachineInstruction,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  let form;
  try {
    form = aarch64OpcodeFormById(instruction.opcode);
  } catch {
    return [
      context.makeDiagnostic({
        code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
        ownerKey: `instruction:${instruction.instructionId}`,
        rootCauseKey: `opcode:${instruction.opcode}`,
        stableDetail: `unknown-opcode:${instruction.opcode}`,
      }),
    ];
  }

  const actualRoles = instruction.operands.map((operand) => operand.role);
  const expectedRoles = form.operandSchema.map((schema) => schema.role);
  if (!operandRolesMatchSchema(actualRoles, form.operandSchema)) {
    diagnostics.push(
      context.makeDiagnostic({
        code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
        ownerKey: `instruction:${instruction.instructionId}`,
        rootCauseKey: `opcode:${instruction.opcode}`,
        stableDetail: `schema:${instruction.instructionId}:${actualRoles.join(",")}:${expectedRoles.join(",")}`,
      }),
    );
  }

  for (const expected of form.implicitResources) {
    const hasResource = instruction.operands.some(
      (operand) =>
        operand.role === expected.role &&
        operand.operand.kind === "resource" &&
        aarch64ResourceStableKey(operand.operand.resource) ===
          aarch64ResourceStableKey(expected.resource),
    );
    if (!hasResource) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `missing-implicit-resource:${instruction.instructionId}:${expected.role}:${aarch64ResourceStableKey(expected.resource)}`,
        }),
      );
    }
  }
  instruction.operands.forEach((operand, index) => {
    const schema = form.operandSchema[index];
    if (schema === undefined) return;
    if (schema.operandKind !== undefined && operand.operand.kind !== schema.operandKind) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-kind-mismatch:${instruction.instructionId}:${index}:${schema.operandKind}:${operand.operand.kind}`,
        }),
      );
    }
    const roleOperandKinds = operandKindsForRole(operand.role);
    if (
      schema.operandKind === undefined &&
      roleOperandKinds !== undefined &&
      !roleOperandKinds.includes(operand.operand.kind)
    ) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-kind-mismatch:${instruction.instructionId}:${index}:${roleOperandKinds.join("|")}:${operand.operand.kind}`,
        }),
      );
    }
    diagnostics.push(...verifyImmediateOperand(context, instruction, operand, schema, form, index));
    if (operand.operand.kind !== "vreg") return;
    const register = operand.operand.register;
    if (schema.registerClass !== undefined && register.registerClass !== schema.registerClass) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-register-class-mismatch:${instruction.instructionId}:${index}:${schema.registerClass}:${register.registerClass}`,
        }),
      );
    }
    if (
      schema.registerClasses !== undefined &&
      !schema.registerClasses.includes(register.registerClass)
    ) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-register-class-mismatch:${instruction.instructionId}:${index}:${schema.registerClasses.join("|")}:${register.registerClass}`,
        }),
      );
    }
    if (!aarch64RegisterClassAcceptsType(register.registerClass, operand.type)) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-register-type-invalid:${instruction.instructionId}:${index}:${register.registerClass}:${aarch64MachineTypeStableKey(operand.type)}`,
        }),
      );
    }
    if (aarch64MachineTypeStableKey(register.type) !== aarch64MachineTypeStableKey(operand.type)) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-type-mismatch:${instruction.instructionId}:${index}:${aarch64MachineTypeStableKey(operand.type)}:${aarch64MachineTypeStableKey(register.type)}`,
        }),
      );
    }
  });
  return diagnostics;
}

function operandKindsForRole(
  role: AArch64InstructionOperand["role"],
): readonly AArch64InstructionOperand["operand"]["kind"][] | undefined {
  switch (role) {
    case "memoryBase":
    case "memoryIndex":
      return ["vreg", "frameObject"];
    case "branchTarget":
      return ["block"];
    case "def":
    case "tiedDefUse":
      return ["vreg"];
    case "implicitDef":
    case "implicitUse":
      return ["resource"];
    case "use":
      return undefined;
  }
}

function verifyImmediateOperand(
  context: AArch64MachineVerifierContext,
  instruction: AArch64MachineInstruction,
  operand: AArch64InstructionOperand,
  schema: AArch64OpcodeOperandSchema,
  form: AArch64OpcodeForm,
  index: number,
): readonly AArch64LoweringDiagnostic[] {
  if (operand.operand.kind !== "immediate") {
    return [];
  }
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  if (isAArch64LogicalImmediateOpcode(form.id)) {
    const width = aarch64LogicalImmediateWidth(operand.type);
    if (!isAArch64LogicalImmediate(operand.operand.value, width)) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-logical-immediate-unencodable:${instruction.instructionId}:${index}:${width}:${operand.operand.value}`,
        }),
      );
    }
  }
  if (
    schema.immediateKind !== undefined &&
    !aarch64InstructionImmediateValueMatchesKind({
      kind: schema.immediateKind,
      value: operand.operand.value,
      operands: instruction.operands,
      form,
    })
  ) {
    diagnostics.push(
      context.makeDiagnostic({
        code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
        ownerKey: `instruction:${instruction.instructionId}`,
        rootCauseKey: `opcode:${instruction.opcode}`,
        stableDetail: `operand-immediate-domain-mismatch:${instruction.instructionId}:${index}:${schema.immediateKind}:${operand.operand.value}`,
      }),
    );
  }
  if (form.immediateBits !== undefined) {
    const maxExclusive = 1n << BigInt(form.immediateBits);
    if (operand.operand.value < 0n || operand.operand.value >= maxExclusive) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: `opcode:${instruction.opcode}`,
          stableDetail: `operand-immediate-width-mismatch:${instruction.instructionId}:${index}:${form.immediateBits}:${operand.operand.value}`,
        }),
      );
    }
  }
  return diagnostics;
}

function operandRolesMatchSchema(
  actualRoles: readonly string[],
  expectedSchema: ReturnType<typeof aarch64OpcodeFormById>["operandSchema"],
): boolean {
  const requiredCount = expectedSchema.filter((schema) => schema.optional !== true).length;
  if (actualRoles.length < requiredCount || actualRoles.length > expectedSchema.length) {
    return false;
  }
  return actualRoles.every((role, index) => role === expectedSchema[index]?.role);
}

function verifyInstructionOperands(input: {
  readonly context: AArch64MachineVerifierContext;
  readonly instruction: AArch64MachineInstruction;
  readonly blockIds: ReadonlySet<unknown>;
  readonly frameObjectIds: ReadonlySet<unknown>;
  readonly declaredRegisters: ReadonlySet<unknown>;
  readonly definedRegisters: Set<unknown>;
  readonly globalSymbols: ReadonlySet<unknown>;
}): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const operand of input.instruction.operands) {
    diagnostics.push(...verifyOperandReference(input.context, input.instruction, operand, input));
    if (operand.operand.kind === "vreg" && isDefRole(operand.role)) {
      input.definedRegisters.add(operand.operand.register.vreg);
    }
  }
  return diagnostics;
}

function abiDefinedRegisters(func: AArch64MachineFunction): Set<unknown> {
  const parameterValueKeys = new Set(func.parameters.map((parameter) => parameter.valueKey));
  return new Set(
    func.virtualRegisters
      .filter(
        (register) =>
          (register.origin?.kind === "optIrValue" &&
            parameterValueKeys.has(`optir.value:${String(register.origin.valueId)}`)) ||
          (register.origin?.kind === "synthetic" &&
            (register.origin.stableKey.includes(":abi-return:") ||
              parameterValueKeys.has(register.origin.stableKey))),
      )
      .map((register) => register.vreg),
  );
}

function verifyOperandReference(
  context: AArch64MachineVerifierContext,
  instruction: AArch64MachineInstruction,
  operand: AArch64InstructionOperand,
  input: {
    readonly blockIds: ReadonlySet<unknown>;
    readonly frameObjectIds: ReadonlySet<unknown>;
    readonly declaredRegisters: ReadonlySet<unknown>;
    readonly definedRegisters: ReadonlySet<unknown>;
    readonly globalSymbols: ReadonlySet<unknown>;
  },
): readonly AArch64LoweringDiagnostic[] {
  switch (operand.operand.kind) {
    case "vreg":
      if (
        !input.declaredRegisters.has(operand.operand.register.vreg) ||
        (isUseRole(operand.role) && !input.definedRegisters.has(operand.operand.register.vreg))
      ) {
        return [
          context.makeDiagnostic({
            code: "AARCH64_UNDEFINED_VIRTUAL_REGISTER",
            ownerKey: `instruction:${instruction.instructionId}`,
            rootCauseKey: `vreg:${operand.operand.register.vreg}`,
            stableDetail: `undefined-vreg:${instruction.instructionId}:${operand.operand.register.vreg}`,
          }),
        ];
      }
      return [];
    case "block":
      return input.blockIds.has(operand.operand.block)
        ? []
        : [
            context.makeDiagnostic({
              code: "AARCH64_INPUT_CONTRACT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: `block:${operand.operand.block}`,
              stableDetail: `missing-block:${instruction.instructionId}:${operand.operand.block}`,
            }),
          ];
    case "frameObject":
      return input.frameObjectIds.has(operand.operand.frameObject)
        ? []
        : [
            context.makeDiagnostic({
              code: "AARCH64_INPUT_CONTRACT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: `frame:${operand.operand.frameObject}`,
              stableDetail: `missing-frame-object:${instruction.instructionId}:${operand.operand.frameObject}`,
            }),
          ];
    case "symbol":
      return input.globalSymbols.has(operand.operand.symbol)
        ? []
        : [
            context.makeDiagnostic({
              code: "AARCH64_UNRESOLVED_SYMBOL_REFERENCE",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: `symbol:${operand.operand.symbol}`,
              stableDetail: `missing-symbol:${instruction.instructionId}:${operand.operand.symbol}`,
            }),
          ];
    case "resource":
    case "immediate":
      return [];
  }
}

function isUseRole(role: AArch64InstructionOperand["role"]): boolean {
  return role === "use" || role === "tiedDefUse" || role === "memoryBase" || role === "memoryIndex";
}

function isDefRole(role: AArch64InstructionOperand["role"]): boolean {
  return role === "def" || role === "tiedDefUse";
}
