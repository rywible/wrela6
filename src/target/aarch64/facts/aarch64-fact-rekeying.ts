import type { OptIrFactId, OptIrValueId } from "../../../opt-ir/ids";
import type { AArch64DroppedFactRecord, AArch64MachineFactSubject } from "../machine-ir/fact-set";
import type { AArch64VirtualRegisterId } from "../machine-ir/ids";

export type AArch64FactRekeyInputSubject =
  | { readonly kind: "value"; readonly valueId: OptIrValueId }
  | AArch64MachineFactSubject;

export interface AArch64FactRekeyInputRecord {
  readonly optIrFactId: OptIrFactId;
  readonly subject: AArch64FactRekeyInputSubject;
  readonly payload: unknown;
}

export type AArch64FactRekeyResult =
  | {
      readonly kind: "ok";
      readonly records: readonly {
        readonly optIrFactId: OptIrFactId;
        readonly machineSubject: AArch64MachineFactSubject;
        readonly payload: unknown;
      }[];
      readonly droppedFacts?: readonly AArch64DroppedFactRecord[];
    }
  | { readonly kind: "error"; readonly reason: string };

export function rekeyAArch64FactsToMachine(input: {
  readonly records: readonly AArch64FactRekeyInputRecord[];
  readonly valueMappings: readonly {
    readonly valueId: OptIrValueId;
    readonly machineVreg: AArch64VirtualRegisterId;
  }[];
  readonly staleSubjectPolicy?: "error" | "drop";
}): AArch64FactRekeyResult {
  const machineRecords: {
    readonly optIrFactId: OptIrFactId;
    readonly machineSubject: AArch64MachineFactSubject;
    readonly payload: unknown;
  }[] = [];
  const droppedFacts: AArch64DroppedFactRecord[] = [];

  for (const record of input.records) {
    const subject = record.subject;
    if (!isOptIrValueSubject(subject)) {
      machineRecords.push({
        optIrFactId: record.optIrFactId,
        machineSubject: subject,
        payload: record.payload,
      });
      continue;
    }

    const mappings = input.valueMappings.filter((mapping) => mapping.valueId === subject.valueId);
    if (mappings.length === 0) {
      const reason = `stale-subject-mapping:value:${subject.valueId}`;
      if (input.staleSubjectPolicy === "drop") {
        droppedFacts.push({ optIrFactId: record.optIrFactId, reason });
        continue;
      }
      return { kind: "error", reason };
    }
    if (mappings.length > 1) {
      return { kind: "error", reason: `ambiguous-subject-mapping:value:${subject.valueId}` };
    }
    const mapping = mappings[0];
    if (mapping === undefined) {
      return { kind: "error", reason: `stale-subject-mapping:value:${subject.valueId}` };
    }
    machineRecords.push({
      optIrFactId: record.optIrFactId,
      machineSubject: { kind: "virtualRegister", vreg: mapping.machineVreg },
      payload: record.payload,
    });
  }

  const records = Object.freeze(machineRecords);
  if (droppedFacts.length > 0) {
    return { kind: "ok", records, droppedFacts: Object.freeze(droppedFacts) };
  }
  return { kind: "ok", records };
}

function isOptIrValueSubject(
  subject: AArch64FactRekeyInputSubject,
): subject is { readonly kind: "value"; readonly valueId: OptIrValueId } {
  return subject.kind === "value";
}
