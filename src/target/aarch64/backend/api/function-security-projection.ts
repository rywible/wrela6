import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64AllocationResult } from "../allocation/allocation-result";
import type { AArch64StackFrameLayout } from "../frame/frame-layout";
import type {
  AArch64HelperCallSecurity,
  AArch64ObservableExit,
  AArch64SecretBranchSite,
  AArch64SecretTableAccess,
  AArch64SecurityPlacement,
  AArch64SecurityWipeEvent,
} from "../facts/security-label-conservation";
import type { AArch64LayoutPhysicalInstruction } from "../object/layout-encode-fixed-point";

export function returnExitInputs(
  functionKey: string,
  machineFunction: AArch64MachineFunction,
): readonly { readonly exitKey: string; readonly kind: "return" }[] {
  return Object.freeze(
    returnExitKeysForFunction(functionKey, machineFunction).map((exitKey) => ({
      exitKey,
      kind: "return" as const,
    })),
  );
}

export function observableExitsForFunction(
  functionKey: string,
  machineFunction: AArch64MachineFunction,
): readonly AArch64ObservableExit[] {
  const exits = machineInstructions(machineFunction).flatMap(
    (instruction): AArch64ObservableExit[] => {
      const exitKind = observableExitKind(String(instruction.opcode));
      if (exitKind === undefined) return [];
      return [
        {
          exitKey: `${functionKey}:${exitKind}:${Number(instruction.instructionId)}`,
          exitKind,
        },
      ];
    },
  );
  return Object.freeze(
    (exits.length === 0
      ? [{ exitKey: `${functionKey}:return`, exitKind: "return" as const }]
      : exits
    ).sort((left, right) => compareCodeUnitStrings(left.exitKey, right.exitKey)),
  );
}

export function securityPlacementsForAllocation(
  allocation: AArch64AllocationResult,
  spillSlots: readonly { readonly slotKey: string }[],
): readonly AArch64SecurityPlacement[] {
  const placements: AArch64SecurityPlacement[] = [];
  const seen = new Set<string>();
  function add(placement: AArch64SecurityPlacement): void {
    const key = `${placement.subjectKey}:${placement.locationKind}:${placement.locationKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    placements.push(placement);
  }
  for (const segment of allocation.segments) {
    add({
      subjectKey: `vreg:${segment.vreg}`,
      locationKind: "register",
      locationKey: segment.physical,
    });
  }
  for (const slot of spillSlots) {
    const subjectKey = subjectKeyFromSpillSlot(slot.slotKey);
    if (subjectKey === undefined) continue;
    add({
      subjectKey,
      locationKind: "spill-slot",
      locationKey: slot.slotKey,
    });
  }
  return Object.freeze(
    placements.sort((left, right) =>
      compareCodeUnitStrings(
        `${left.subjectKey}:${left.locationKind}:${left.locationKey}`,
        `${right.subjectKey}:${right.locationKind}:${right.locationKey}`,
      ),
    ),
  );
}

export function securityWipesForFrame(
  frame: AArch64StackFrameLayout,
  exitKeys: readonly string[],
): readonly AArch64SecurityWipeEvent[] {
  return Object.freeze(
    frame.wipeSlots
      .flatMap((slot): AArch64SecurityWipeEvent[] => {
        const subjectKey = subjectKeyFromSpillSlot(slot.slotKey);
        if (subjectKey === undefined) return [];
        return exitKeys.map((exitKey) => ({
          subjectKey,
          slotKey: slot.slotKey,
          beforeExitKey: exitKey,
        }));
      })
      .sort((left, right) =>
        compareCodeUnitStrings(
          `${left.subjectKey}:${left.slotKey}:${left.beforeExitKey}`,
          `${right.subjectKey}:${right.slotKey}:${right.beforeExitKey}`,
        ),
      ),
  );
}

export function securityBranchSitesForInstructions(
  instructions: readonly AArch64LayoutPhysicalInstruction[],
): readonly AArch64SecretBranchSite[] {
  return Object.freeze(
    instructions
      .flatMap((instruction): AArch64SecretBranchSite[] => {
        const conditionSubjectKey = instruction.security?.branchConditionSubjectKey;
        if (conditionSubjectKey === undefined) return [];
        return [
          {
            branchKey: instruction.siteKey ?? instruction.stableKey,
            conditionSubjectKey,
          },
        ];
      })
      .sort((left, right) =>
        compareCodeUnitStrings(
          `${left.branchKey}:${left.conditionSubjectKey}`,
          `${right.branchKey}:${right.conditionSubjectKey}`,
        ),
      ),
  );
}

export function securityTableAccessesForInstructions(
  instructions: readonly AArch64LayoutPhysicalInstruction[],
): readonly AArch64SecretTableAccess[] {
  return Object.freeze(
    instructions
      .flatMap((instruction): AArch64SecretTableAccess[] => {
        const indexSubjectKey = instruction.security?.tableIndexSubjectKey;
        if (indexSubjectKey === undefined) return [];
        return [
          {
            tableKey: instruction.siteKey ?? instruction.stableKey,
            indexSubjectKey,
          },
        ];
      })
      .sort((left, right) =>
        compareCodeUnitStrings(
          `${left.tableKey}:${left.indexSubjectKey}`,
          `${right.tableKey}:${right.indexSubjectKey}`,
        ),
      ),
  );
}

export function securityHelperCallsForInstructions(
  instructions: readonly AArch64LayoutPhysicalInstruction[],
): readonly AArch64HelperCallSecurity[] {
  return Object.freeze(
    instructions
      .flatMap((instruction): AArch64HelperCallSecurity[] => {
        const argumentSubjectKeys = instruction.security?.helperArgumentSubjectKeys ?? [];
        if (argumentSubjectKeys.length === 0) return [];
        const target = instruction.operands.find((operand) => operand.kind === "relocation-target");
        return [
          {
            helperKey: target?.kind === "relocation-target" ? target.target : instruction.stableKey,
            argumentSubjectKeys: Object.freeze(
              [...argumentSubjectKeys].sort(compareCodeUnitStrings),
            ),
          },
        ];
      })
      .sort((left, right) =>
        compareCodeUnitStrings(
          `${left.helperKey}:${left.argumentSubjectKeys.join(",")}`,
          `${right.helperKey}:${right.argumentSubjectKeys.join(",")}`,
        ),
      ),
  );
}

function machineInstructions(
  machineFunction: AArch64MachineFunction,
): readonly AArch64MachineInstruction[] {
  return Object.freeze(
    machineFunction.blocks.flatMap((block) => [
      ...block.instructions,
      ...(block.terminator === undefined ? [] : [block.terminator]),
    ]),
  );
}

function returnExitKeysForFunction(
  functionKey: string,
  machineFunction: AArch64MachineFunction,
): readonly string[] {
  const returnKeys = machineInstructions(machineFunction)
    .filter((instruction) => String(instruction.opcode) === "ret")
    .map((instruction) => `${functionKey}:return:${Number(instruction.instructionId)}`);
  return Object.freeze(
    returnKeys.length === 0 ? [`${functionKey}:return`] : returnKeys.sort(compareCodeUnitStrings),
  );
}

function observableExitKind(opcode: string): AArch64ObservableExit["exitKind"] | undefined {
  if (opcode === "ret") return "return";
  if (opcode === "trap") return "trap";
  if (opcode === "br") return "tail-call";
  return undefined;
}

function subjectKeyFromSpillSlot(slotKey: string): string | undefined {
  const match = /^spill-slot:vreg:(\d+)$/.exec(slotKey);
  return match === null ? undefined : `vreg:${match[1]}`;
}
