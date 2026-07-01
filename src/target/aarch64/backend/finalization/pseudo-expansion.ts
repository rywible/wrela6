import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import { commitAArch64InstructionRewrite } from "../api/backend-rewrite-application";
import type { AArch64PhysicalInstruction, AArch64PhysicalOperand } from "./physical-instruction-ir";

export type AArch64BackendPseudo =
  | {
      readonly stableKey: string;
      readonly kind: "load-frame";
      readonly frameObjectId: number;
      readonly destination: string;
    }
  | {
      readonly stableKey: string;
      readonly kind: "move";
      readonly source: string;
      readonly destination: string;
    }
  | { readonly stableKey: string; readonly kind: "zero"; readonly destination: string }
  | {
      readonly stableKey: string;
      readonly kind: "spill" | "reload";
      readonly register?: string;
      readonly frameObjectId?: number;
    }
  | {
      readonly stableKey: string;
      readonly kind: "remat";
      readonly register?: string;
      readonly value?: bigint;
    }
  | { readonly stableKey: string; readonly kind: "barrier" | "trap" | "noreturn" };

export function expandAArch64BackendPseudos(input: {
  readonly frameSlots?: readonly {
    readonly frameObjectId: number;
    readonly base: string;
    readonly offsetBytes: number;
  }[];
  readonly pseudos: readonly AArch64BackendPseudo[];
}): AArch64BackendResult<{ readonly instructions: readonly AArch64PhysicalInstruction[] }> {
  const slots = new Map((input.frameSlots ?? []).map((slot) => [slot.frameObjectId, slot]));
  const diagnostics = validatePseudoExpansion(input.pseudos, slots);
  if (diagnostics.length > 0) return backendError(diagnostics);
  const instructions: AArch64PhysicalInstruction[] = [];
  const rewriteDiagnostics: AArch64BackendDiagnostic[] = [];
  for (const pseudo of [...input.pseudos].sort((left, right) =>
    compareCodeUnitStrings(left.stableKey, right.stableKey),
  )) {
    const expanded = expand(pseudo, slots);
    const committed = commitAArch64InstructionRewrite({
      kind: pseudoRewriteKind(pseudo),
      source: { stableKey: pseudo.stableKey, opcode: `pseudo:${pseudo.kind}` },
      replacements: [expanded],
    });
    if (committed.kind === "error") rewriteDiagnostics.push(...committed.diagnostics);
    else instructions.push(...committed.value.instructions);
  }
  if (rewriteDiagnostics.length > 0) return backendError(rewriteDiagnostics);
  return backendOk({ instructions: Object.freeze(instructions) });
}

function validatePseudoExpansion(
  pseudos: readonly AArch64BackendPseudo[],
  slots: ReadonlyMap<number, { readonly base: string; readonly offsetBytes: number }>,
): readonly AArch64BackendDiagnostic[] {
  return pseudos.flatMap((pseudo) => {
    if (pseudo.kind === "load-frame" && !slots.has(pseudo.frameObjectId)) {
      return [
        diagnostic(
          `pseudo-expansion:frame-slot-missing:${pseudo.stableKey}:frame-object:${pseudo.frameObjectId}`,
        ),
      ];
    }
    if (
      (pseudo.kind === "spill" || pseudo.kind === "reload") &&
      pseudo.frameObjectId === undefined
    ) {
      return [
        diagnostic(`pseudo-expansion:frame-object-missing:${pseudo.stableKey}:${pseudo.kind}`),
      ];
    }
    if (
      (pseudo.kind === "spill" || pseudo.kind === "reload") &&
      pseudo.frameObjectId !== undefined &&
      !slots.has(pseudo.frameObjectId)
    ) {
      return [
        diagnostic(
          `pseudo-expansion:frame-slot-missing:${pseudo.stableKey}:frame-object:${pseudo.frameObjectId}`,
        ),
      ];
    }
    if ((pseudo.kind === "spill" || pseudo.kind === "reload") && pseudo.register === undefined) {
      return [diagnostic(`pseudo-expansion:register-missing:${pseudo.stableKey}:${pseudo.kind}`)];
    }
    if (pseudo.kind === "remat" && pseudo.register === undefined) {
      return [diagnostic(`pseudo-expansion:register-missing:${pseudo.stableKey}:remat`)];
    }
    if (pseudo.kind === "remat" && !isMoveWideInteger(pseudo.value)) {
      return [
        diagnostic(`pseudo-expansion:value-missing-or-unencodable:${pseudo.stableKey}:remat`),
      ];
    }
    return [];
  });
}

function expand(
  pseudo: AArch64BackendPseudo,
  slots: Map<number, { readonly base: string; readonly offsetBytes: number }>,
): AArch64PhysicalInstruction {
  if (pseudo.kind === "load-frame") {
    const slot = slots.get(pseudo.frameObjectId)!;
    return instruction(pseudo.stableKey, "ldr-unsigned-immediate", [
      { kind: "register", register: pseudo.destination },
      { kind: "memory", base: slot.base, offsetBytes: slot.offsetBytes },
    ]);
  }
  if (pseudo.kind === "move")
    return instruction(pseudo.stableKey, "add-immediate", [
      { kind: "register", register: pseudo.destination },
      { kind: "register", register: pseudo.source },
      { kind: "immediate", value: 0 },
    ]);
  if (pseudo.kind === "zero")
    return instruction(pseudo.stableKey, "movz", [
      { kind: "register", register: pseudo.destination },
      { kind: "immediate", value: 0 },
    ]);
  if (pseudo.kind === "barrier") return instruction(pseudo.stableKey, "dmb", []);
  if (pseudo.kind === "trap" || pseudo.kind === "noreturn")
    return instruction(pseudo.stableKey, "trap", []);
  if (pseudo.kind === "remat")
    return instruction(pseudo.stableKey, "movz", [
      { kind: "register", register: pseudo.register! },
      { kind: "immediate", value: Number(pseudo.value!) },
    ]);
  if (pseudo.kind === "spill" || pseudo.kind === "reload") {
    const slot = slots.get(pseudo.frameObjectId!)!;
    return instruction(
      pseudo.stableKey,
      pseudo.kind === "reload" ? "ldr-unsigned-immediate" : "str-unsigned-immediate",
      [
        { kind: "register", register: pseudo.register! },
        { kind: "memory", base: slot.base, offsetBytes: slot.offsetBytes },
      ],
    );
  }
  return instruction(pseudo.stableKey, "movz", []);
}

function instruction(
  stableKey: string,
  opcode: string,
  operands: readonly AArch64PhysicalOperand[],
): AArch64PhysicalInstruction {
  return Object.freeze({ stableKey, opcode, operands: Object.freeze(operands) });
}

function pseudoRewriteKind(pseudo: AArch64BackendPseudo) {
  if (pseudo.kind === "spill" || pseudo.kind === "reload") return "spill-insertion";
  if (pseudo.kind === "remat") return "rematerialization";
  return "instruction-replacement";
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FINALIZATION_INVALID",
    ownerKey: "pseudo-expansion",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}

function isMoveWideInteger(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= 0xffffn;
}
