import type { OptIrValueId } from "../../../opt-ir/ids";
import { aarch64FloatMachineType } from "../machine-ir/machine-types";
import type { AArch64InstructionFlags } from "../machine-ir/machine-instruction";
import {
  defVreg,
  implicitDefResource,
  implicitUseResource,
  useVreg,
  type AArch64InstructionOperand,
} from "../machine-ir/operands";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import {
  selectAArch64FusedMultiplyAdd,
  type AArch64FpEnvironmentPolicy,
  type AArch64FpNumericFactAnswer,
  type AArch64FpNumericSelection,
} from "../select/fp-selection";
import type { OperationOf } from "./operation-materialization-helpers";

type FpNumericMaterializationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly stableDetail: string };

type FpNumericSourceRegisterResult =
  | { readonly kind: "ok"; readonly register: AArch64VirtualRegister }
  | { readonly kind: "error"; readonly stableDetail: string };

export interface AArch64FpNumericMaterializationInput {
  readonly operation: OperationOf<"fpNumeric">;
  readonly fpContractionForOperation?: (
    operationId: OperationOf<"fpNumeric">["operationId"],
  ) => AArch64FpNumericFactAnswer | undefined;
  readonly fpEnvironment?: AArch64FpEnvironmentPolicy;
  readonly vectorPolicyForOperation?: (
    operation: OperationOf<"fpNumeric">,
  ) => { readonly policy: "scalarOnly" | "ownsVectorState" | "callsVectorHelper" } | undefined;
  readonly syntheticRegister: (
    label: string,
    type: ReturnType<typeof aarch64FloatMachineType>,
  ) => AArch64VirtualRegister;
  readonly resultRegister: (
    operation: OperationOf<"fpNumeric">,
    index: number,
  ) => AArch64VirtualRegister;
  readonly sourceRegisterAt: (
    sourceValueIds: readonly OptIrValueId[],
    index: number,
  ) => FpNumericSourceRegisterResult;
  readonly recordDecision: (
    decision: Pick<AArch64FpNumericSelection, "factsUsed" | "explanation">,
  ) => void;
  readonly emit: (
    opcode: string,
    operands: readonly AArch64InstructionOperand[],
    flags: AArch64InstructionFlags,
    label: string,
    issueClass: "fp",
  ) => void;
}

export function materializeAArch64FpNumericOperation(
  input: AArch64FpNumericMaterializationInput,
): FpNumericMaterializationResult {
  const { operation } = input;
  const output =
    operation.resultIds.length === 0
      ? input.syntheticRegister("fp-discard", aarch64FloatMachineType(64))
      : input.resultRegister(operation, 0);
  const left = input.sourceRegisterAt(operation.sourceValueIds, 0);
  if (left.kind === "error") return left;
  const right = input.sourceRegisterAt(operation.sourceValueIds, 1);
  if (right.kind === "error") return right;
  const addend = input.sourceRegisterAt(operation.sourceValueIds, 2);
  if (addend.kind === "error") return addend;

  const selection = selectAArch64FusedMultiplyAdd({
    operationId: operation.operationId,
    factAnswer: input.fpContractionForOperation?.(operation.operationId) ?? {
      kind: "unknown",
      factsUsed: [],
      explanation: [
        `No FP numeric fact query is in scope for operation:${String(operation.operationId)}.`,
      ],
    },
    fpEnvironment: input.fpEnvironment,
    resultRegisterClass: output.registerClass,
    sourceRegisterClasses: [
      left.register.registerClass,
      right.register.registerClass,
      addend.register.registerClass,
    ],
    vectorPolicy: input.vectorPolicyForOperation?.(operation)?.policy,
    numericContract: operation.numericContract,
  });
  input.recordDecision(selection);
  if (selection.kind === "rejected") {
    return { kind: "error", stableDetail: selection.reason };
  }
  input.emit(
    selection.opcode,
    [
      defVreg(output, output.type),
      useVreg(left.register, left.register.type),
      useVreg(right.register, right.register.type),
      useVreg(addend.register, addend.register.type),
      implicitUseResource({ kind: "FPCR" }),
      implicitDefResource({ kind: "FPSR" }),
    ],
    { mayTrap: false },
    operation.kind,
    "fp",
  );
  return { kind: "ok" };
}
