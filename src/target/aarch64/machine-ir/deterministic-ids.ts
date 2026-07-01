import type { OptIrFunctionId } from "../../../opt-ir/ids";
import { aarch64MachineFunctionId, type AArch64MachineFunctionId } from "./ids";

export interface AArch64FunctionIdAllocationEntry {
  readonly optIrFunctionId: OptIrFunctionId;
  readonly machineFunctionId: AArch64MachineFunctionId;
}

export interface AArch64FunctionIdAllocation {
  readonly machineFunctionFor: (optIrFunctionId: OptIrFunctionId) => AArch64MachineFunctionId;
  readonly entries: () => readonly AArch64FunctionIdAllocationEntry[];
}

export function allocateAArch64FunctionIds(
  optIrFunctionIds: readonly OptIrFunctionId[],
): AArch64FunctionIdAllocation {
  const sortedOptIrFunctionIds = Object.freeze(
    [...optIrFunctionIds].sort((left, right) => left - right),
  );
  const entries = Object.freeze(
    sortedOptIrFunctionIds.map((optIrFunctionId, index) =>
      Object.freeze({
        optIrFunctionId,
        machineFunctionId: aarch64MachineFunctionId(index),
      }),
    ),
  );
  const byOptIrId = new Map<OptIrFunctionId, AArch64MachineFunctionId>(
    entries.map((entry) => [entry.optIrFunctionId, entry.machineFunctionId]),
  );

  return Object.freeze({
    machineFunctionFor(optIrFunctionId: OptIrFunctionId): AArch64MachineFunctionId {
      const machineFunctionId = byOptIrId.get(optIrFunctionId);
      if (machineFunctionId === undefined) {
        throw new RangeError(
          `No AArch64 machine function allocated for OptIR function ${optIrFunctionId}.`,
        );
      }
      return machineFunctionId;
    },
    entries() {
      return entries;
    },
  });
}
