import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64AllocationResult } from "../allocation/allocation-result";
import type { AArch64RematerializationRecipe, AArch64RepairDraft } from "../allocation/spill-remat";
import type { AArch64PhysicalInstruction } from "../finalization/physical-instruction-ir";
import type { AArch64FrameSlot } from "../frame/frame-layout";
import type { AArch64BackendDiagnostic } from "./diagnostics";
import {
  aarch64FinalizationDiagnostic,
  firstSpilledUseScratch,
  immediateValueOf,
  originStableKey,
  physicalRegisterForVreg,
  stackRepairInstruction,
  uniqueVregsForRoles,
  type AArch64MachineInstructionLoweringResult,
} from "./machine-lowering-helpers";

export interface AArch64LoweringRepairContext {
  readonly repairDrafts: readonly AArch64RepairDraft[];
  readonly frameSlots: readonly AArch64FrameSlot[];
  readonly frameSizeBytes: number;
  readonly scratchRegisters: readonly string[];
}

type AArch64MachineInstructionLowerer = (
  functionKey: string,
  instruction: AArch64MachineInstruction,
  allocation: AArch64AllocationResult,
  overrideRegisters: ReadonlyMap<number, string>,
  context: AArch64MachineInstructionLoweringContext,
) => AArch64MachineInstructionLoweringResult;

interface AArch64MachineInstructionLoweringContext {
  readonly instructionOrder: number;
  readonly nzcvConditionSubjectKey?: string;
  readonly callBoundary?: {
    readonly instructionId: number;
    readonly argumentRegisters: readonly string[];
    readonly resultRegisters: readonly string[];
  };
}

interface AArch64LoweringRepairPlan {
  readonly slotByVreg: ReadonlyMap<number, AArch64LoweringSpillSlot>;
  readonly rematByVreg: ReadonlyMap<number, AArch64RematerializationRecipe>;
  readonly scratchRegisters: readonly string[];
}

interface AArch64LoweringSpillSlot {
  readonly slotKey: string;
  readonly offsetBytes: number;
}

export function buildLoweringRepairPlan(
  repairContext: AArch64LoweringRepairContext | undefined,
): AArch64LoweringRepairPlan {
  if (repairContext === undefined) {
    return Object.freeze({
      slotByVreg: new Map(),
      rematByVreg: new Map(),
      scratchRegisters: Object.freeze([]),
    });
  }
  const frameSlotByKey = new Map(repairContext.frameSlots.map((slot) => [slot.slotKey, slot]));
  const slotByVreg = new Map<number, AArch64LoweringSpillSlot>();
  const rematByVreg = new Map<number, AArch64RematerializationRecipe>();
  for (const draft of repairContext.repairDrafts) {
    if (draft.kind === "remat") {
      if (draft.rematerialization !== undefined)
        rematByVreg.set(draft.vreg, draft.rematerialization);
      continue;
    }
    if (draft.slotKey === undefined) continue;
    const frameSlot = frameSlotByKey.get(draft.slotKey);
    if (frameSlot === undefined) continue;
    slotByVreg.set(draft.vreg, {
      slotKey: draft.slotKey,
      offsetBytes: repairContext.frameSizeBytes + frameSlot.offsetBytes,
    });
  }
  return Object.freeze({
    slotByVreg,
    rematByVreg,
    scratchRegisters: Object.freeze([...repairContext.scratchRegisters]),
  });
}

export function lowerMachineInstructionWithRepairs(
  functionKey: string,
  instruction: AArch64MachineInstruction,
  allocation: AArch64AllocationResult,
  repairPlan: AArch64LoweringRepairPlan,
  lowerInstruction: AArch64MachineInstructionLowerer,
  context: AArch64MachineInstructionLoweringContext,
):
  | { readonly kind: "ok"; readonly instructions: readonly AArch64PhysicalInstruction[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] } {
  const stableKey = `insn:${functionKey}:${instruction.instructionId}`;
  const rematerializedDefinitions = unallocatedVregsForRoles(
    instruction,
    ["def"],
    allocation,
  ).filter((vreg) => repairPlan.rematByVreg.has(vreg));
  if (rematerializedDefinitions.length > 0) {
    if (canElideRematerializedDefinition(instruction, rematerializedDefinitions, repairPlan)) {
      return { kind: "ok", instructions: Object.freeze([]) };
    }
    return {
      kind: "error",
      diagnostics: [
        aarch64FinalizationDiagnostic(
          `physical-ir:remat-definition-not-elidable:vreg:${rematerializedDefinitions[0]}:instruction:${stableKey}`,
        ),
      ],
    };
  }

  const unallocatedUses = unallocatedVregsForRoles(
    instruction,
    ["use", "tiedDefUse", "memoryBase", "memoryIndex"],
    allocation,
  );
  const rematUses = unallocatedUses.filter((vreg) => repairPlan.rematByVreg.has(vreg));
  const spilledUses = unallocatedUses.filter(
    (vreg) => !repairPlan.rematByVreg.has(vreg) && repairPlan.slotByVreg.has(vreg),
  );
  const spilledDefs = unallocatedVregsForRoles(
    instruction,
    ["def", "tiedDefUse"],
    allocation,
  ).filter((vreg) => repairPlan.slotByVreg.has(vreg));
  if (spilledUses.length === 0 && spilledDefs.length === 0 && rematUses.length === 0) {
    const lowered = lowerInstruction(functionKey, instruction, allocation, new Map(), context);
    return lowered.kind === "ok"
      ? { kind: "ok", instructions: Object.freeze([lowered.instruction]) }
      : lowered;
  }

  const allocatedRegisters = new Set(
    uniqueVregsForRoles(instruction, ["def", "use", "tiedDefUse", "memoryBase", "memoryIndex"])
      .flatMap(
        (vreg) =>
          physicalRegisterForVreg(vreg, allocation, new Map(), context.instructionOrder) ?? [],
      )
      .filter((register) => repairPlan.scratchRegisters.includes(register)),
  );
  const availableScratch = repairPlan.scratchRegisters.filter(
    (register) => !allocatedRegisters.has(register),
  );
  const overrideRegisters = new Map<number, string>();
  const diagnostics: AArch64BackendDiagnostic[] = [];
  let scratchCursor = 0;
  for (const vreg of uniqueVregs([...rematUses, ...spilledUses])) {
    const scratch = availableScratch[scratchCursor];
    if (scratch === undefined) {
      diagnostics.push(aarch64FinalizationDiagnostic(noScratchDiagnostic(vreg, repairPlan)));
      continue;
    }
    overrideRegisters.set(vreg, scratch);
    scratchCursor += 1;
  }
  for (const vreg of spilledDefs) {
    if (overrideRegisters.has(vreg)) continue;
    const scratch = availableScratch[scratchCursor] ?? firstSpilledUseScratch(overrideRegisters);
    if (scratch === undefined) {
      diagnostics.push(
        aarch64FinalizationDiagnostic(`physical-ir:spill-repair:no-scratch:vreg:${vreg}`),
      );
      continue;
    }
    overrideRegisters.set(vreg, scratch);
    if (availableScratch[scratchCursor] !== undefined) scratchCursor += 1;
  }
  if (diagnostics.length > 0) return { kind: "error", diagnostics };

  const provenanceSource = originStableKey(instruction.origin);
  const reloads = spilledUses.map((vreg) =>
    stackRepairInstruction({
      stableKey: `${stableKey}:reload:vreg:${vreg}`,
      opcode: "ldr-unsigned-immediate",
      register: overrideRegisters.get(vreg)!,
      slot: repairPlan.slotByVreg.get(vreg)!,
      provenanceSource,
    }),
  );
  const remats = rematUses.map((vreg) =>
    rematerializationInstruction({
      stableKey: `${stableKey}:remat:vreg:${vreg}`,
      register: overrideRegisters.get(vreg)!,
      rematerialization: repairPlan.rematByVreg.get(vreg)!,
      provenanceSource,
    }),
  );
  const lowered = lowerInstruction(
    functionKey,
    instruction,
    allocation,
    overrideRegisters,
    context,
  );
  if (lowered.kind === "error") return lowered;
  const spills = spilledDefs.map((vreg) =>
    stackRepairInstruction({
      stableKey: `${stableKey}:spill:vreg:${vreg}`,
      opcode: "str-unsigned-immediate",
      register: overrideRegisters.get(vreg)!,
      slot: repairPlan.slotByVreg.get(vreg)!,
      provenanceSource,
    }),
  );
  return {
    kind: "ok",
    instructions: Object.freeze([...reloads, ...remats, lowered.instruction, ...spills]),
  };
}

function unallocatedVregsForRoles(
  instruction: AArch64MachineInstruction,
  roles: readonly AArch64MachineInstruction["operands"][number]["role"][],
  allocation: AArch64AllocationResult,
): readonly number[] {
  return uniqueVregsForRoles(instruction, roles).filter(
    (vreg) => physicalRegisterForVreg(vreg, allocation) === undefined,
  );
}

function canElideRematerializedDefinition(
  instruction: AArch64MachineInstruction,
  definitions: readonly number[],
  repairPlan: AArch64LoweringRepairPlan,
): boolean {
  if (definitions.length !== 1 || String(instruction.opcode) !== "movz") return false;
  if (
    instruction.flags.mayTrap ||
    instruction.flags.mayLoad === true ||
    instruction.flags.mayStore === true
  ) {
    return false;
  }
  if (
    uniqueVregsForRoles(instruction, ["use", "tiedDefUse", "memoryBase", "memoryIndex"]).length > 0
  ) {
    return false;
  }
  const rematerialization = repairPlan.rematByVreg.get(definitions[0]!);
  return (
    rematerialization?.kind === "constant" &&
    rematerialization.value === immediateValueOf(instruction)
  );
}

function rematerializationInstruction(input: {
  readonly stableKey: string;
  readonly register: string;
  readonly rematerialization: AArch64RematerializationRecipe;
  readonly provenanceSource: string;
}): AArch64PhysicalInstruction {
  return {
    stableKey: input.stableKey,
    opcode: "movz",
    operands: [
      { kind: "register", register: input.register },
      { kind: "immediate", value: Number(input.rematerialization.value) },
    ],
    provenanceSource: input.provenanceSource,
  };
}

function noScratchDiagnostic(vreg: number, repairPlan: AArch64LoweringRepairPlan): string {
  return repairPlan.rematByVreg.has(vreg)
    ? `physical-ir:remat-repair:no-scratch:vreg:${vreg}`
    : `physical-ir:spill-repair:no-scratch:vreg:${vreg}`;
}

function uniqueVregs(vregs: readonly number[]): readonly number[] {
  return Object.freeze([...new Set(vregs)].sort((left, right) => left - right));
}
