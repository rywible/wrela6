export type AArch64ImplementationId = "cortex-a76-rpi5-like" | "generic-armv8.2-a";

export type AArch64ErrataRecord =
  | {
      readonly kind: "substitution";
      readonly erratumId: string;
      readonly matchOpcode: string;
      readonly replacementOpcode: string;
      readonly stableDetail: string;
    }
  | {
      readonly kind: "schedule-constraint";
      readonly erratumId: string;
      readonly requiredSpacing: number;
      readonly sourceOpcode: string;
      readonly blockedFollowerOpcode: string;
      readonly stableDetail: string;
    };

export type ApplyAArch64ErrataInput = {
  readonly implementationId: AArch64ImplementationId;
  readonly opcode: string;
};

export type ApplyAArch64ErrataResult =
  | {
      readonly kind: "substitute";
      readonly erratumId: string;
      readonly opcode: string;
      readonly stableDetail: string;
    }
  | { readonly kind: "unchanged"; readonly opcode: string };

const A76_RPI5_LIKE_ERRATA = Object.freeze([
  {
    kind: "substitution",
    erratumId: "A76_1286807",
    matchOpcode: "STP_PRE_INDEX",
    replacementOpcode: "SUB_ADD_STP_OFFSET",
    stableDetail: "erratum:A76_1286807:substitute:STP_PRE_INDEX:SUB_ADD_STP_OFFSET",
  },
  {
    kind: "schedule-constraint",
    erratumId: "A76_1463225",
    requiredSpacing: 1,
    sourceOpcode: "MRS_CNTVCT_EL0",
    blockedFollowerOpcode: "ISB",
    stableDetail: "erratum:A76_1463225:schedule-spacing:MRS_CNTVCT_EL0:ISB:1",
  },
] as const satisfies readonly AArch64ErrataRecord[]);

export function errataForAArch64Implementation(
  implementationId: AArch64ImplementationId,
): readonly AArch64ErrataRecord[] {
  switch (implementationId) {
    case "cortex-a76-rpi5-like":
      return A76_RPI5_LIKE_ERRATA;
    case "generic-armv8.2-a":
      return [];
  }
}

export function applyAArch64Errata(input: ApplyAArch64ErrataInput): ApplyAArch64ErrataResult {
  for (const erratum of errataForAArch64Implementation(input.implementationId)) {
    if (erratum.kind === "substitution" && erratum.matchOpcode === input.opcode) {
      return {
        kind: "substitute",
        erratumId: erratum.erratumId,
        opcode: erratum.replacementOpcode,
        stableDetail: erratum.stableDetail,
      };
    }
  }
  return { kind: "unchanged", opcode: input.opcode };
}

export function aarch64ErrataScheduleConstraintsForOpcode(
  input: ApplyAArch64ErrataInput,
): readonly string[] {
  return Object.freeze(
    errataForAArch64Implementation(input.implementationId)
      .filter(
        (erratum) =>
          erratum.kind === "schedule-constraint" &&
          (erratum.sourceOpcode === input.opcode || erratum.blockedFollowerOpcode === input.opcode),
      )
      .map((erratum) => erratum.stableDetail)
      .sort(),
  );
}
