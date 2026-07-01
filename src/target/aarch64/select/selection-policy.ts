import {
  AARCH64_OPCODE_FORMS,
  aarch64OpcodeFormById,
  aarch64OpcodeFormId,
  type AArch64OpcodeFormId,
} from "../machine-ir/opcode-catalog";
import { aarch64Diagnostic, sortAArch64Diagnostics } from "../machine-ir/diagnostics";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import { aarch64MachineBlock } from "../machine-ir/machine-block";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import { aarch64MachineProgram } from "../machine-ir/machine-program";
import { aarch64ScheduleMetadata } from "../machine-ir/schedule";
import type { AArch64LoweringState } from "../lower/pipeline-stages";
import { appendAArch64PlanningRecord } from "../lower/pipeline-stages";
import {
  aarch64ErrataScheduleConstraintsForOpcode,
  applyAArch64Errata,
  type AArch64ImplementationId,
} from "../target-surface/errata-catalog";

const EXCLUDED_FAMILIES = ["sve2", "sve", "mops", "pauth", "bti", "mte"] as const;

export function filterAArch64OpcodeCandidateByProfile(input: {
  readonly opcode: AArch64OpcodeFormId | string;
  readonly targetProfileFeatures?: readonly string[];
}):
  | { readonly kind: "accepted"; readonly opcode: string }
  | { readonly kind: "rejected"; readonly reason: string } {
  const family = outOfProfileFamilyForOpcode(input.opcode);
  if (family !== undefined) {
    return {
      kind: "rejected",
      reason: `excluded-instruction-family:${family.featureName}`,
    };
  }
  const known = AARCH64_OPCODE_FORMS.some((form) => String(form.id) === String(input.opcode));
  if (!known) return { kind: "rejected", reason: "unknown-opcode" };
  const formRecord = aarch64OpcodeFormById(aarch64OpcodeFormId(String(input.opcode)));
  const targetProfileFeatures = new Set(input.targetProfileFeatures ?? ["BASE_A64"]);
  for (const feature of formRecord.requiredFeatures) {
    if (!targetProfileFeatures.has(feature)) {
      return { kind: "rejected", reason: `missing-profile-feature:${feature}` };
    }
  }
  return { kind: "accepted", opcode: String(input.opcode) };
}

export function applyAArch64OutOfProfileAndErrataStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  const result = applyAArch64OutOfProfileAndErrata(state);
  if (result.kind === "ok") {
    return result.state;
  }
  throw new RangeError(result.diagnostics.map((diagnostic) => diagnostic.stableDetail).join("\n"));
}

export function applyAArch64OutOfProfileAndErrata(state: AArch64LoweringState):
  | { readonly kind: "ok"; readonly state: AArch64LoweringState }
  | {
      readonly kind: "error";
      readonly diagnostics: ReturnType<typeof aarch64Diagnostic>[];
    } {
  if (state.machineProgram === undefined) {
    return {
      kind: "ok",
      state: recordProfileAndErrataPlanning(state, ["profile-and-errata:missing-machine-program"]),
    };
  }
  const diagnostics: ReturnType<typeof aarch64Diagnostic>[] = [];
  const implementationId = state.target.profile.tuningModel as AArch64ImplementationId;
  const errataDetails = new Set<string>();
  const nextFunctions = state.machineProgram.functions.entries().map((func) =>
    aarch64MachineFunction({
      ...func,
      blocks: func.blocks.map((block) =>
        aarch64MachineBlock({
          ...block,
          instructions: block.instructions.map((instruction) =>
            applyProfileAndErrataToInstruction({
              instruction,
              implementationId,
              profileId: state.target.profile.profileId,
              profileFeatures: state.target.profile.requiredFeatures,
              diagnostics,
              errataDetails,
            }),
          ),
          ...(block.terminator === undefined
            ? {}
            : {
                terminator: applyProfileAndErrataToInstruction({
                  instruction: block.terminator,
                  implementationId,
                  profileId: state.target.profile.profileId,
                  profileFeatures: state.target.profile.requiredFeatures,
                  diagnostics,
                  errataDetails,
                }),
              }),
        }),
      ),
    }),
  );
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortAArch64Diagnostics(diagnostics) };
  }
  const nextProgram = aarch64MachineProgram({
    ...state.machineProgram,
    functions: nextFunctions,
  });
  return {
    kind: "ok",
    state: recordProfileAndErrataPlanning(
      Object.freeze({ ...state, machineProgram: nextProgram }),
      [
        "profile-and-errata-filtered",
        ...[...errataDetails].sort().map((detail) => `profile-and-errata:${detail}`),
      ],
    ),
  };
}

function applyProfileAndErrataToInstruction(input: {
  readonly instruction: AArch64MachineInstruction;
  readonly implementationId: AArch64ImplementationId;
  readonly profileId: string;
  readonly profileFeatures: readonly string[];
  readonly diagnostics: ReturnType<typeof aarch64Diagnostic>[];
  readonly errataDetails: Set<string>;
}): AArch64MachineInstruction {
  const opcode = String(input.instruction.opcode);
  const family = outOfProfileFamilyForOpcode(opcode);
  if (family !== undefined) {
    input.diagnostics.push(
      aarch64Diagnostic({
        code: "AARCH64_OUT_OF_PROFILE_INSTRUCTION",
        ownerKey: `instruction:${input.instruction.instructionId}`,
        rootCauseKey: family.featureName,
        stableDetail: `out-of-profile-instruction:${input.profileId}:${family.featureName}:${opcode}:instruction:${input.instruction.instructionId}`,
      }),
    );
  }
  const featureCheck = filterAArch64OpcodeCandidateByProfile({
    opcode,
    targetProfileFeatures: ["BASE_A64", ...input.profileFeatures],
  });
  if (
    featureCheck.kind === "rejected" &&
    featureCheck.reason.startsWith("missing-profile-feature:")
  ) {
    input.diagnostics.push(
      aarch64Diagnostic({
        code: "AARCH64_OUT_OF_PROFILE_INSTRUCTION",
        ownerKey: `instruction:${input.instruction.instructionId}`,
        rootCauseKey: featureCheck.reason.slice("missing-profile-feature:".length),
        stableDetail: `out-of-profile-instruction:${input.profileId}:${featureCheck.reason}:${opcode}:instruction:${input.instruction.instructionId}`,
      }),
    );
  }
  const substitution = applyAArch64Errata({
    implementationId: input.implementationId,
    opcode,
  });
  const substituted =
    substitution.kind === "substitute"
      ? Object.freeze({
          ...input.instruction,
          opcode: aarch64OpcodeFormId(substitution.opcode),
        })
      : input.instruction;
  if (substitution.kind === "substitute") {
    input.errataDetails.add(substitution.stableDetail);
  }
  const constraints = aarch64ErrataScheduleConstraintsForOpcode({
    implementationId: input.implementationId,
    opcode: String(substituted.opcode),
  });
  if (constraints.length === 0) {
    return substituted;
  }
  constraints.forEach((constraint) => input.errataDetails.add(constraint));
  return Object.freeze({
    ...substituted,
    schedule: aarch64ScheduleMetadata({
      ...substituted.schedule,
      errataConstraints: [...new Set([...substituted.schedule.errataConstraints, ...constraints])],
    }),
  });
}

function outOfProfileFamilyForOpcode(
  opcode: AArch64OpcodeFormId | string,
):
  | { readonly family: (typeof EXCLUDED_FAMILIES)[number]; readonly featureName: string }
  | undefined {
  const lowered = String(opcode).toLowerCase();
  for (const family of EXCLUDED_FAMILIES) {
    if (lowered.includes(family)) {
      return { family, featureName: `FEAT_${family.toUpperCase()}` };
    }
  }
  return undefined;
}

function recordProfileAndErrataPlanning(
  state: AArch64LoweringState,
  explanations: readonly string[],
): AArch64LoweringState {
  return appendAArch64PlanningRecord(state, {
    stageKey: "apply-out-of-profile-and-errata",
    subjectKey: "program",
    action: "profile-and-errata-filtered",
    explanation: Object.freeze([...explanations].sort()),
  });
}
