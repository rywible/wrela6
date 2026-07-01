import type { OptIrFactId, OptIrValueId } from "../../../opt-ir/ids";
import type { AArch64VirtualRegisterId } from "../machine-ir/ids";

export interface AArch64FactRekeyInputRecord {
  readonly optIrFactId: OptIrFactId;
  readonly subject: { readonly kind: "value"; readonly valueId: OptIrValueId };
  readonly payload: unknown;
}

export type AArch64FactRekeyResult =
  | {
      readonly kind: "ok";
      readonly records: readonly {
        readonly optIrFactId: OptIrFactId;
        readonly machineSubject: {
          readonly kind: "virtualRegister";
          readonly vreg: AArch64VirtualRegisterId;
        };
        readonly payload: unknown;
      }[];
    }
  | { readonly kind: "error"; readonly reason: string };

export function rekeyAArch64FactsToMachine(input: {
  readonly records: readonly AArch64FactRekeyInputRecord[];
  readonly valueMappings: readonly {
    readonly valueId: OptIrValueId;
    readonly machineVreg: AArch64VirtualRegisterId;
  }[];
}): AArch64FactRekeyResult {
  const machineRecords: {
    readonly optIrFactId: OptIrFactId;
    readonly machineSubject: {
      readonly kind: "virtualRegister";
      readonly vreg: AArch64VirtualRegisterId;
    };
    readonly payload: unknown;
  }[] = [];

  for (const record of input.records) {
    const mappings = input.valueMappings.filter(
      (mapping) => mapping.valueId === record.subject.valueId,
    );
    if (mappings.length === 0) {
      return { kind: "error", reason: `stale-subject-mapping:value:${record.subject.valueId}` };
    }
    if (mappings.length > 1) {
      return { kind: "error", reason: `ambiguous-subject-mapping:value:${record.subject.valueId}` };
    }
    const mapping = mappings[0];
    if (mapping === undefined) {
      return { kind: "error", reason: `stale-subject-mapping:value:${record.subject.valueId}` };
    }
    machineRecords.push({
      optIrFactId: record.optIrFactId,
      machineSubject: { kind: "virtualRegister", vreg: mapping.machineVreg },
      payload: record.payload,
    });
  }

  return { kind: "ok", records: Object.freeze(machineRecords) };
}
