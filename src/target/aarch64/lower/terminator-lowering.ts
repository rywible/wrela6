import type { OptIrCfgEdgeTable } from "../../../opt-ir/cfg";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrTerminator } from "../../../opt-ir/terminators";
import type { OptIrBlockParameter } from "../../../opt-ir/values";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import type { AArch64MachineBlock } from "../machine-ir/machine-block";
import type { AArch64JumpTableRecord } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import type { AArch64RelocationReference } from "../machine-ir/relocation-reference";
import { branchTarget, useVreg } from "../machine-ir/operands";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import { chooseAArch64BranchShape } from "./branch-switch-profitability";
import { branchToEdge, edgeBranchTarget } from "./edge-copy-lowering";
import { abiLocationKey } from "./materialization-contracts";
import type { AArch64LoweringSelectionRecord, AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";
import { lowerSwitchTerminator } from "./switch-terminator-lowering";
import {
  returnAbiRegister,
  terminatorCopyInstruction,
  terminatorInstruction,
} from "./terminator-instruction-helpers";

export type AArch64TerminatorShape = "b" | "b-cond" | "cbz" | "tbz" | "ret" | "trap" | "jump-table";

export type LowerAArch64TerminatorResult =
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64MachineInstruction[];
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly relocationReferences?: readonly AArch64RelocationReference[];
      readonly jumpTables: readonly AArch64JumpTableRecord[];
      readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
      readonly instruction?: AArch64MachineInstruction;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId?: OptIrOperationId;
    };

export function lowerAArch64Terminator(input: {
  readonly kind: "jump" | "branch" | "return" | "trap" | "switch";
  readonly operandShape?: "zero" | "bit" | "flags" | "general";
  readonly terminalCold?: boolean;
}): { readonly shape: AArch64TerminatorShape; readonly terminalCold: boolean } {
  switch (input.kind) {
    case "jump":
      return { shape: "b", terminalCold: input.terminalCold ?? false };
    case "branch":
      if (input.operandShape === "zero") return { shape: "cbz", terminalCold: false };
      if (input.operandShape === "bit") return { shape: "tbz", terminalCold: false };
      return { shape: "b-cond", terminalCold: false };
    case "return":
      return { shape: "ret", terminalCold: false };
    case "trap":
      return { shape: "trap", terminalCold: true };
    case "switch":
      return { shape: "jump-table", terminalCold: input.terminalCold ?? false };
  }
}

export function lowerAArch64TerminatorsStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  return recordAArch64StagePlanning(state, "lower-terminators", "terminators-shaped");
}

export function lowerTerminator(input: {
  readonly terminator: OptIrTerminator | undefined;
  readonly edges: OptIrCfgEdgeTable;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly blockParametersByBlock: ReadonlyMap<OptIrBlockId, readonly OptIrBlockParameter[]>;
  readonly returnLocations: readonly AArch64AbiLocation[];
}): LowerAArch64TerminatorResult {
  if (input.terminator === undefined) {
    return {
      kind: "ok",
      instructions: [],
      edgeBlocks: [],
      virtualRegisters: [],
      jumpTables: [],
      selectionRecords: [],
    };
  }
  switch (input.terminator.kind) {
    case "jump":
      return branchToEdge({
        operationId: input.terminator.operationId,
        edgeId: input.terminator.edge,
        edges: input.edges,
        valueRegisters: input.valueRegisters,
        blockParametersByBlock: input.blockParametersByBlock,
      });
    case "branch": {
      const condition = input.valueRegisters.get(input.terminator.condition);
      const trueTarget =
        condition === undefined
          ? undefined
          : edgeBranchTarget({
              operationId: input.terminator.operationId,
              edgeId: input.terminator.trueEdge,
              edges: input.edges,
              valueRegisters: input.valueRegisters,
              blockParametersByBlock: input.blockParametersByBlock,
            });
      const falseTarget =
        condition === undefined
          ? undefined
          : edgeBranchTarget({
              operationId: input.terminator.operationId,
              edgeId: input.terminator.falseEdge,
              edges: input.edges,
              valueRegisters: input.valueRegisters,
              blockParametersByBlock: input.blockParametersByBlock,
            });
      if (
        trueTarget === undefined ||
        falseTarget === undefined ||
        trueTarget.kind === "error" ||
        falseTarget.kind === "error" ||
        condition === undefined
      ) {
        return {
          kind: "error",
          operationId: input.terminator.operationId,
          stableDetail:
            trueTarget?.kind === "error"
              ? trueTarget.stableDetail
              : falseTarget?.kind === "error"
                ? falseTarget.stableDetail
                : `lower-terminator:invalid-branch:${String(input.terminator.operationId)}`,
        };
      }
      return {
        kind: "ok",
        instructions: [
          terminatorInstruction(input.terminator.operationId, "cbnz", [
            useVreg(condition, condition.type),
            branchTarget(trueTarget.target),
          ]),
        ],
        edgeBlocks: [...trueTarget.edgeBlocks, ...falseTarget.edgeBlocks],
        virtualRegisters: [...trueTarget.virtualRegisters, ...falseTarget.virtualRegisters],
        jumpTables: [],
        selectionRecords: [
          branchSelectionRecord({
            operationId: input.terminator.operationId,
            decision: chooseAArch64BranchShape({
              chainLength: 1,
              nzcvSerialCost: 1,
              ifConversionLegal: false,
            }),
            emittedOpcodes: ["cbnz", "b"],
          }),
        ],
        instruction: terminatorInstruction(
          input.terminator.operationId,
          "b",
          [branchTarget(falseTarget.target)],
          1,
        ),
      };
    }
    case "switch":
      return lowerSwitchTerminator({
        terminator: input.terminator,
        edges: input.edges,
        valueRegisters: input.valueRegisters,
        blockParametersByBlock: input.blockParametersByBlock,
      });
    case "return": {
      const instructions: AArch64MachineInstruction[] = [];
      const virtualRegisters: AArch64VirtualRegister[] = [];
      const abiReturnRegisters: AArch64VirtualRegister[] = [];
      for (let index = 0; index < input.terminator.values.length; index += 1) {
        const returnValue = input.terminator.values[index];
        const sourceRegister =
          returnValue === undefined ? undefined : input.valueRegisters.get(returnValue);
        if (returnValue === undefined || sourceRegister === undefined) {
          return {
            kind: "error",
            operationId: input.terminator.operationId,
            stableDetail: `lower-terminator:missing-return-value:${String(input.terminator.operationId)}:${index}`,
          };
        }
        const location = input.returnLocations[index] ?? {
          kind: "intReg" as const,
          index,
        };
        const abiReturnRegister = returnAbiRegister({
          operationId: input.terminator.operationId,
          index,
          location,
          sourceRegister,
        });
        virtualRegisters.push(abiReturnRegister);
        abiReturnRegisters.push(abiReturnRegister);
        instructions.push(
          terminatorCopyInstruction({
            operationId: input.terminator.operationId,
            sequenceIndex: index,
            output: abiReturnRegister,
            input: sourceRegister,
            label: `abi-return:${abiLocationKey(location)}:${index}`,
          }),
        );
      }
      const firstReturnRegister = abiReturnRegisters[0];
      return {
        kind: "ok",
        instructions,
        edgeBlocks: [],
        virtualRegisters,
        jumpTables: [],
        selectionRecords: [],
        instruction: terminatorInstruction(
          input.terminator.operationId,
          "ret",
          firstReturnRegister === undefined
            ? []
            : [useVreg(firstReturnRegister, firstReturnRegister.type)],
          input.terminator.values.length,
        ),
      };
    }
    case "unreachable":
      return {
        kind: "ok",
        instructions: [],
        edgeBlocks: [],
        virtualRegisters: [],
        jumpTables: [],
        selectionRecords: [],
        instruction: terminatorInstruction(input.terminator.operationId, "trap", []),
      };
  }
}

function branchSelectionRecord(input: {
  readonly operationId: OptIrOperationId;
  readonly decision: ReturnType<typeof chooseAArch64BranchShape>;
  readonly emittedOpcodes: readonly string[];
}): AArch64LoweringSelectionRecord {
  return Object.freeze({
    stageKey: "lower-terminators",
    subjectKey: `terminator:${String(input.operationId)}`,
    patternId: String(input.decision.patternId),
    tier: "planning",
    coveredOperationIds: [Number(input.operationId)],
    factsUsed: [],
    emittedOpcodes: Object.freeze([...input.emittedOpcodes]),
    explanation: Object.freeze([
      `branch-profitability:${input.decision.kind}`,
      `branch-profitability:reason:${input.decision.reason}`,
    ]),
  });
}
