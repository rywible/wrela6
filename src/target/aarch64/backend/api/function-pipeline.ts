import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64MachineProgram } from "../../machine-ir/machine-program";
import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64AbiLocation as AArch64MachineAbiLocation } from "../../machine-ir/abi-location";
import type { AArch64RegisterClass } from "../../machine-ir/machine-types";
import {
  classifyAArch64PublicAbiBoundary,
  type AArch64MachineAbiValue,
} from "../abi/abi-classification";
import {
  reconcileAArch64CallBoundaries,
  type AArch64ReconciledCallBoundary,
} from "../abi/call-boundary-reconciliation";
import { allocateAArch64Registers } from "../allocation/allocator";
import type {
  AArch64AllocationRepairRequest,
  AArch64AllocatorInterval,
  AArch64BackendRegisterClass,
} from "../allocation/allocation-result";
import { buildAArch64InterferenceGraph } from "../allocation/interference";
import { buildAArch64LiveIntervals } from "../allocation/liveness";
import { resolveAArch64ParallelCopies } from "../allocation/move-resolution";
import {
  repairAllocationWithSpillsAndRemats,
  type AArch64AllocationRepairWorkItem,
} from "../allocation/spill-remat";
import { buildAArch64PhysicalInstructionIr } from "../finalization/physical-instruction-ir";
import { scheduleAArch64PostAllocation } from "../finalization/post-ra-scheduler";
import { layoutAArch64StackFrame } from "../frame/frame-layout";
import { finalizeAArch64PrologueEpilogue } from "../frame/prologue-epilogue";
import { planAArch64Unwind } from "../frame/unwind-plan";
import type {
  AArch64ObservableExit,
  AArch64SecurityPlacement,
  AArch64SecurityWipeEvent,
  AArch64SecretBranchSite,
  AArch64SecretTableAccess,
  AArch64HelperCallSecurity,
} from "../facts/security-label-conservation";
import type { AArch64BackendFactIndex } from "../facts/backend-fact-query";
import type {
  AArch64LayoutFragmentInput,
  AArch64LayoutPhysicalInstruction,
} from "../object/layout-encode-fixed-point";
import { verifyAArch64Allocation } from "../verify/allocation-verifier";
import type { AArch64BackendTargetSurface } from "./backend-target-surface";
import type { AArch64ClosedImageBackendPlan } from "./closed-image-backend-plan";
import {
  backendOk,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "./diagnostics";
import type { AArch64BackendStageKey } from "./backend-pipeline";
import { frameFinalizationInstructionsForAArch64Function } from "./function-finalization-instructions";
import { machineCallSiteForInstruction, type AArch64MachineCallSite } from "./machine-call-sites";
import {
  aarch64FinalizationDiagnostic,
  layoutAArch64InstructionFromPhysicalInstruction,
  lowerAArch64MachineInstructions,
} from "./machine-lowering";
import {
  parallelCopiesForFunctionEntry,
  physicalMoveInstructionsForResolvedCopies,
  physicalRegisterAliasPairs,
} from "./function-copy-resolution";
import { rematerializationAuthoritiesFromFacts } from "./function-rematerialization";
import {
  observableExitsForFunction,
  returnExitInputs,
  securityBranchSitesForInstructions,
  securityHelperCallsForInstructions,
  securityPlacementsForAllocation,
  securityTableAccessesForInstructions,
  securityWipesForFrame,
} from "./function-security-projection";
import {
  aarch64FunctionStageFailure,
  earlierAArch64BackendStage,
  runAArch64FunctionStage,
} from "./function-stage-runner";
import {
  instructionDefinesNzcv,
  instructionUsesNzcv,
  isSchedulerBoundaryOpcode,
  isSchedulerCallBoundaryOpcode,
  isSchedulerObservableExitOpcode,
  schedulerDefinedRegisters,
  schedulerUsedRegisters,
} from "./post-ra-scheduler-classification";
import {
  callLocationConstraintsForFunction,
  constraintsByVirtualRegister,
  loweringCallBoundaries,
  requiredPhysicalRegisterForSegment,
  type AArch64CallLocationConstraint,
} from "./function-call-constraints";

export interface AArch64FunctionBackendArtifact {
  readonly functionKey: string;
  readonly allocationPlan: readonly string[];
  readonly securityPlacements: readonly AArch64SecurityPlacement[];
  readonly securityWipes: readonly AArch64SecurityWipeEvent[];
  readonly securityExits: readonly AArch64ObservableExit[];
  readonly securityBranches: readonly AArch64SecretBranchSite[];
  readonly securityTableAccesses: readonly AArch64SecretTableAccess[];
  readonly securityHelperCalls: readonly AArch64HelperCallSecurity[];
  readonly frameShape: string;
  readonly frameSizeBytes: number;
  readonly wipeSlotKeys: readonly string[];
}

export function buildAArch64LayoutFragmentsForProgram(
  machineProgram: AArch64MachineProgram,
  plan: AArch64ClosedImageBackendPlan,
  factIndex: AArch64BackendFactIndex,
  target: AArch64BackendTargetSurface,
):
  | {
      readonly kind: "ok";
      readonly fragments: readonly AArch64LayoutFragmentInput[];
      readonly functionArtifacts: readonly AArch64FunctionBackendArtifact[];
    }
  | {
      readonly kind: "error";
      readonly failedStage: AArch64BackendStageKey;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    } {
  const functions = machineProgram.functions.entries();
  if (functions.length === 0) {
    return {
      kind: "ok",
      functionArtifacts: Object.freeze([]),
      fragments: Object.freeze([]),
    };
  }
  const fragments: AArch64LayoutFragmentInput[] = [];
  const functionArtifacts: AArch64FunctionBackendArtifact[] = [];
  const diagnostics: AArch64BackendDiagnostic[] = [];
  let failedStage: AArch64BackendStageKey | undefined;
  const functionBySymbol = new Map(
    functions.map((machineFunction) => [String(machineFunction.symbol), machineFunction]),
  );
  for (const machineFunction of functions) {
    const fragment = functionFragment(machineFunction, plan, factIndex, target, functionBySymbol);
    if (fragment.kind === "error") {
      diagnostics.push(...fragment.diagnostics);
      failedStage = earlierAArch64BackendStage(failedStage, fragment.failedStage);
    } else {
      fragments.push(fragment.fragment);
      functionArtifacts.push(fragment.artifact);
    }
  }
  return diagnostics.length === 0
    ? {
        kind: "ok",
        fragments: Object.freeze(fragments),
        functionArtifacts: Object.freeze(functionArtifacts),
      }
    : {
        kind: "error",
        failedStage: failedStage ?? "build-physical-ir-and-expand-pseudos",
        diagnostics: sortAArch64BackendDiagnostics(diagnostics),
      };
}

function functionFragment(
  machineFunction: AArch64MachineFunction,
  plan: AArch64ClosedImageBackendPlan,
  factIndex: AArch64BackendFactIndex,
  target: AArch64BackendTargetSurface,
  functionBySymbol: ReadonlyMap<string, AArch64MachineFunction>,
):
  | {
      readonly kind: "ok";
      readonly fragment: AArch64LayoutFragmentInput;
      readonly artifact: AArch64FunctionBackendArtifact;
    }
  | {
      readonly kind: "error";
      readonly failedStage: AArch64BackendStageKey;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    } {
  const functionKey = String(machineFunction.symbol);
  const stageResult = runSemanticStagesForFunction(
    machineFunction,
    plan,
    factIndex,
    target,
    functionBySymbol,
  );
  if (stageResult.kind === "error") return stageResult;
  const hasFrameEpilogue = stageResult.epilogueInstructions.length > 0;
  const instructions: AArch64LayoutPhysicalInstruction[] = [
    ...stageResult.prologueInstructions,
    ...instructionsWithExitEpilogues({
      instructions: stageResult.instructions,
      returnEpilogueInstructions: stageResult.epilogueInstructions,
      trapPreludeInstructions: stageResult.trapPreludeInstructions,
      tailCallPreludeInstructions: stageResult.tailCallPreludeInstructions,
    }),
  ];
  if (
    !hasFrameEpilogue &&
    !instructions.some((instruction) => instruction.opcode === "ret") &&
    !instructions.some((instruction) => isObservableTerminalOpcode(instruction.opcode))
  ) {
    instructions.push({ stableKey: `${functionKey}:return`, opcode: "ret", operands: [] });
  }
  return {
    kind: "ok",
    fragment: Object.freeze({
      stableKey: `text.${functionKey}`,
      sectionKey: ".text",
      instructions: Object.freeze(instructions),
    }),
    artifact: stageResult.artifact,
  };
}

function instructionsWithExitEpilogues(input: {
  readonly instructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly returnEpilogueInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly trapPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly tailCallPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
}): readonly AArch64LayoutPhysicalInstruction[] {
  if (
    input.returnEpilogueInstructions.length === 0 &&
    input.trapPreludeInstructions.length === 0 &&
    input.tailCallPreludeInstructions.length === 0
  ) {
    return Object.freeze([...input.instructions]);
  }
  const output: AArch64LayoutPhysicalInstruction[] = [];
  let replacedReturnCount = 0;
  let handledTerminalExitCount = 0;
  for (const instruction of input.instructions) {
    if (instruction.opcode === "ret") {
      output.push(...instructionsForExitSite(input.returnEpilogueInstructions, instruction));
      replacedReturnCount += 1;
      handledTerminalExitCount += 1;
    } else if (instruction.opcode === "trap") {
      output.push(...instructionsForExitSite(input.trapPreludeInstructions, instruction));
      output.push(instruction);
      handledTerminalExitCount += 1;
    } else if (instruction.opcode === "br") {
      output.push(...instructionsForExitSite(input.tailCallPreludeInstructions, instruction));
      output.push(instruction);
      handledTerminalExitCount += 1;
    } else {
      output.push(instruction);
    }
  }
  if (replacedReturnCount === 0 && handledTerminalExitCount === 0) {
    output.push(
      ...instructionsForExitSite(input.returnEpilogueInstructions, {
        stableKey: "implicit-return",
        opcode: "ret",
        operands: [],
      }),
    );
  }
  return Object.freeze(output);
}

function instructionsForExitSite(
  epilogueInstructions: readonly AArch64LayoutPhysicalInstruction[],
  exitInstruction: AArch64LayoutPhysicalInstruction,
): readonly AArch64LayoutPhysicalInstruction[] {
  return Object.freeze(
    epilogueInstructions.map((instruction) => ({
      ...instruction,
      stableKey: `${exitInstruction.stableKey}:${instruction.stableKey}`,
      ...(instruction.siteKey === undefined
        ? {}
        : { siteKey: `${exitInstruction.stableKey}:${instruction.siteKey}` }),
      provenanceSource: exitInstruction.provenanceSource ?? instruction.provenanceSource,
    })),
  );
}

function isObservableTerminalOpcode(opcode: string): boolean {
  return opcode === "trap" || opcode === "br";
}

function runSemanticStagesForFunction(
  machineFunction: AArch64MachineFunction,
  plan: AArch64ClosedImageBackendPlan,
  factIndex: AArch64BackendFactIndex,
  target: AArch64BackendTargetSurface,
  functionBySymbol: ReadonlyMap<string, AArch64MachineFunction>,
):
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64LayoutPhysicalInstruction[];
      readonly prologueInstructions: readonly AArch64LayoutPhysicalInstruction[];
      readonly epilogueInstructions: readonly AArch64LayoutPhysicalInstruction[];
      readonly trapPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
      readonly tailCallPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
      readonly callBoundaries: readonly AArch64ReconciledCallBoundary[];
      readonly artifact: AArch64FunctionBackendArtifact;
    }
  | {
      readonly kind: "error";
      readonly failedStage: AArch64BackendStageKey;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    } {
  const functionKey = String(machineFunction.symbol);
  const machineCallSites = machineCallSitesForFunction(functionKey, machineFunction);
  const functionParameters = abiValuesForMachineParameters(machineFunction);
  const functionReturns = abiValuesForMachineReturns(machineFunction);
  const publicBoundary = runAArch64FunctionStage({
    stageKey: "classify-public-abi",
    execute: () =>
      classifyAArch64PublicAbiBoundary(
        {
          boundaryKey: functionKey,
          boundaryKind: "exported-function",
          parameters: functionParameters,
          returns: functionReturns,
        },
        target,
      ),
  });
  if (publicBoundary.kind === "error") return publicBoundary;
  const reconciled = runAArch64FunctionStage({
    stageKey: "reconcile-call-boundaries",
    execute: () =>
      reconcileAArch64CallBoundaries({
        targetSurface: target,
        callerKey: functionKey,
        callSites: machineCallSites.map((callSite) => ({
          callKey: callSite.callKey,
          callerKey: callSite.caller,
          calleeKey: callSite.callee,
          boundaryKind: isPrivateClosedImageBoundary(callSite, plan) ? "closed-image" : "public",
          parameters: abiValuesForMachineParameters(functionBySymbol.get(callSite.callee)),
          returns: abiValuesForMachineReturns(functionBySymbol.get(callSite.callee)),
        })),
        privateConventions: plan.privateConventions.map((record) => ({
          callerKey: record.caller,
          calleeKey: record.callee,
          ...(record.argumentLocations === undefined
            ? {}
            : { argumentLocations: record.argumentLocations }),
          ...(record.resultLocations === undefined
            ? {}
            : { resultLocations: record.resultLocations }),
          ...(record.clobberedGprs === undefined ? {} : { clobberedGprs: record.clobberedGprs }),
          ...(record.pinnedLiveThroughGprs === undefined
            ? {}
            : { pinnedLiveThroughGprs: record.pinnedLiveThroughGprs }),
          ...(record.calleeSaveObligations === undefined
            ? {}
            : { calleeSaveObligations: record.calleeSaveObligations }),
          ...(record.potentialVeneerClobberGprs === undefined
            ? {}
            : { potentialVeneerClobberGprs: record.potentialVeneerClobberGprs }),
          ...(record.tailCallEligible === undefined
            ? {}
            : { tailCallEligible: record.tailCallEligible }),
        })),
      }),
  });
  if (reconciled.kind === "error") return reconciled;
  const noSpillVregs = noSpillVirtualRegisters(factIndex);
  const wipeOnSpillVregs = wipeOnSpillVirtualRegisters(factIndex);
  const livenessStage = runAArch64FunctionStage({
    stageKey: "build-liveness-and-interference",
    execute: () => {
      const liveness = buildAArch64LiveIntervals({
        func: machineFunction,
        noSpillVregs,
        callBoundaries: livenessCallBoundaries(machineCallSites, reconciled.value.boundaries),
      });
      const physicalAliases = physicalRegisterAliasPairs(target);
      const interference = buildAArch64InterferenceGraph({
        intervals: liveness.intervals,
        aliases: physicalAliases,
      });
      return backendOk({ liveness, physicalAliases, interference });
    },
  });
  if (livenessStage.kind === "error") return livenessStage;
  const { liveness, physicalAliases, interference } = livenessStage.value;
  const callLocationConstraints = callLocationConstraintsForFunction(
    machineFunction,
    reconciled.value.boundaries,
  );
  const allocatorIntervals = allocatorIntervalsFromLiveness(
    liveness.intervals,
    interference,
    callLocationConstraints,
  );
  const fixedCallRegisters = uniqueSortedRegisters(
    callLocationConstraints.map((constraint) => constraint.register),
  );
  const scratchRegisters = Object.freeze(
    target.registerModel.veneerScratchGprs.filter(
      (register) => !fixedCallRegisters.includes(register),
    ),
  );
  const allocationPools = allocationRegisterPools(target);
  const boundaryUnavailableRegisters = unavailableRegistersFromCallBoundaries(
    reconciled.value.boundaries,
  ).filter((register) => !fixedCallRegisters.includes(register));
  const allocationStage = runAArch64FunctionStage({
    stageKey: "allocate-registers",
    execute: () => {
      const result = allocateAArch64Registers({
        intervals: allocatorIntervals,
        availableGprs: allocationPools.gprs,
        availableVectorRegisters: allocationPools.vectors,
        availableFpRegisters: allocationPools.fps,
        unavailableRegisters: uniqueSortedRegisters([
          ...scratchRegisters,
          ...boundaryUnavailableRegisters,
        ]),
        aliases: physicalAliases,
      });
      return result.kind === "error" ? result : backendOk(result.allocation, result.diagnostics);
    },
  });
  if (allocationStage.kind === "error") return allocationStage;
  const allocation = allocationStage.value;
  const repair = runAArch64FunctionStage({
    stageKey: "repair-spills-and-remats",
    execute: () =>
      repairAllocationWithSpillsAndRemats({
        requests: allocation.repairRequests.map((request) =>
          repairWorkItemForAllocationRequest(request, allocatorIntervals, {
            noSpillVregs,
            wipeOnSpillVregs,
          }),
        ),
        rematerialization: rematerializationAuthoritiesFromFacts(factIndex),
      }),
  });
  if (repair.kind === "error") return repair;
  const copies = runAArch64FunctionStage({
    stageKey: "resolve-parallel-copies",
    execute: () => {
      const result = resolveAArch64ParallelCopies({
        copies: parallelCopiesForFunctionEntry(machineFunction, allocation),
        availableTemporaries: scratchRegisters,
        unavailableTemporaries: boundaryUnavailableRegisters,
        memorySwapAllowed: false,
      });
      return result.kind === "error" ? result : backendOk(result.moves, result.diagnostics);
    },
  });
  if (copies.kind === "error") return copies;
  const verified = runAArch64FunctionStage({
    stageKey: "verify-allocation",
    execute: () => {
      const result = verifyAArch64Allocation({
        allocation,
        intervals: allocatorIntervals,
        noSpillVregs,
        aliases: physicalAliases,
      });
      return result.kind === "error" ? result : backendOk(undefined, result.diagnostics);
    },
  });
  if (verified.kind === "error") return verified;
  const frame = runAArch64FunctionStage({
    stageKey: "layout-frames",
    execute: () =>
      layoutAArch64StackFrame({
        functionKey,
        spillSlots: repair.value.spillSlots,
        savedRegisters: reconciled.value.boundaries.length === 0 ? [] : ["x30"],
      }),
  });
  if (frame.kind === "error") return frame;
  if (frame.value.wipeSlots.length > 0 && scratchRegisters[0] === undefined) {
    return aarch64FunctionStageFailure("finalize-prologue-epilogue-tail-trap-noreturn", [
      aarch64FinalizationDiagnostic(`physical-ir:wipe-slot:no-scratch:${functionKey}`),
    ]);
  }
  const finalization = runAArch64FunctionStage({
    stageKey: "finalize-prologue-epilogue-tail-trap-noreturn",
    execute: () =>
      finalizeAArch64PrologueEpilogue({
        frame: frame.value,
        exits: returnExitInputs(functionKey, machineFunction),
      }),
  });
  if (finalization.kind === "error") return finalization;
  const unwind = runAArch64FunctionStage({
    stageKey: "plan-unwind",
    execute: () =>
      planAArch64Unwind({
        frame: frame.value,
        finalization: finalization.value,
        unwindCatalog: target.unwindCatalog,
      }),
  });
  if (unwind.kind === "error") return unwind;
  const frameInstructions = runAArch64FunctionStage({
    stageKey: "finalize-prologue-epilogue-tail-trap-noreturn",
    execute: () =>
      frameFinalizationInstructionsForAArch64Function({
        functionKey,
        frame: frame.value,
        scratchRegister: scratchRegisters[0],
      }),
  });
  if (frameInstructions.kind === "error") return frameInstructions;
  const lowered = runAArch64FunctionStage({
    stageKey: "build-physical-ir-and-expand-pseudos",
    execute: () => {
      const result = lowerAArch64MachineInstructions(
        functionKey,
        machineFunction,
        allocation,
        {
          repairDrafts: repair.value.drafts,
          frameSlots: frame.value.slots,
          frameSizeBytes: frame.value.totalSizeBytes,
          scratchRegisters,
        },
        loweringCallBoundaries(machineFunction, reconciled.value.boundaries),
      );
      return result.kind === "error" ? result : backendOk({ instructions: result.instructions });
    },
  });
  if (lowered.kind === "error") return lowered;
  const copyInstructions = runAArch64FunctionStage({
    stageKey: "resolve-parallel-copies",
    execute: () => {
      const result = physicalMoveInstructionsForResolvedCopies(functionKey, copies.value);
      return result.kind === "error" ? result : backendOk({ instructions: result.instructions });
    },
  });
  if (copyInstructions.kind === "error") return copyInstructions;
  const physical = runAArch64FunctionStage({
    stageKey: "build-physical-ir-and-expand-pseudos",
    execute: () =>
      buildAArch64PhysicalInstructionIr({
        instructions: Object.freeze([
          ...copyInstructions.value.instructions,
          ...lowered.value.instructions,
        ]),
      }),
  });
  if (physical.kind === "error") return physical;
  const scheduled = runAArch64FunctionStage({
    stageKey: "post-ra-schedule-and-peephole",
    execute: () =>
      scheduleAArch64PostAllocation({
        instructions: physical.value.instructions.map((instruction, index) => ({
          id: index,
          stableKey: instruction.stableKey,
          opcode: instruction.opcode,
          memoryKey: instruction.memoryKey,
          barrier: isSchedulerBoundaryOpcode(instruction.opcode),
          callBoundary: isSchedulerCallBoundaryOpcode(instruction.opcode),
          observableExit: isSchedulerObservableExitOpcode(instruction.opcode),
          definedRegisters: schedulerDefinedRegisters(instruction),
          usedRegisters: schedulerUsedRegisters(instruction),
          definesNzcv: instructionDefinesNzcv(instruction.opcode),
          usesNzcv: instructionUsesNzcv(instruction.opcode),
        })),
      }),
  });
  if (scheduled.kind === "error") return scheduled;
  const byStableKey = new Map(
    physical.value.instructions.map((instruction) => [instruction.stableKey, instruction]),
  );
  const instructions: AArch64LayoutPhysicalInstruction[] = [];
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const instruction of scheduled.value.instructions) {
    const physicalInstruction = byStableKey.get(instruction.stableKey);
    if (physicalInstruction === undefined) {
      diagnostics.push(
        aarch64FinalizationDiagnostic(
          `physical-ir:scheduled-instruction-missing:${functionKey}:${instruction.stableKey}`,
        ),
      );
      continue;
    }
    instructions.push(layoutAArch64InstructionFromPhysicalInstruction(physicalInstruction));
  }
  if (diagnostics.length > 0) {
    return aarch64FunctionStageFailure("post-ra-schedule-and-peephole", diagnostics);
  }
  const securityExits = observableExitsForFunction(functionKey, machineFunction);
  return {
    kind: "ok",
    instructions: Object.freeze(instructions),
    prologueInstructions: frameInstructions.value.prologueInstructions,
    epilogueInstructions: frameInstructions.value.epilogueInstructions,
    trapPreludeInstructions: frameInstructions.value.trapPreludeInstructions,
    tailCallPreludeInstructions: frameInstructions.value.tailCallPreludeInstructions,
    callBoundaries: reconciled.value.boundaries,
    artifact: Object.freeze({
      functionKey,
      allocationPlan: Object.freeze(
        [
          ...reconciled.value.boundaries.map(
            (boundary) =>
              `call-boundary:${boundary.boundaryKind}:${boundary.callKey}:clobber:${boundary.clobberedGprs.join(",")}:vclobber:${boundary.clobberedVectorRegisters.join(",")}:pin:${boundary.pinnedLiveThroughGprs.join(",")}:veneer:${boundary.potentialVeneerClobberGprs.join(",")}`,
          ),
          ...allocation.segments.map(
            (segment) =>
              `vreg:${segment.vreg}:${segment.physical}:${segment.startOrder}-${segment.endOrder}`,
          ),
          ...repair.value.drafts.map((draft) => `repair:${draft.kind}:${draft.useSiteKey}`),
          ...copies.value.map(
            (move) =>
              `move-resolution:${move.value}:${move.sourceRegister}->${move.destinationRegister}`,
          ),
        ].sort(compareCodeUnitStrings),
      ),
      securityPlacements: securityPlacementsForAllocation(allocation, repair.value.spillSlots),
      securityWipes: securityWipesForFrame(
        frame.value,
        securityExits.map((exit) => exit.exitKey),
      ),
      securityExits,
      securityBranches: securityBranchSitesForInstructions(instructions),
      securityTableAccesses: securityTableAccessesForInstructions(instructions),
      securityHelperCalls: securityHelperCallsForInstructions(instructions),
      frameShape: unwind.value.classification,
      frameSizeBytes: unwind.value.frameSizeBytes,
      wipeSlotKeys: Object.freeze(
        frame.value.wipeSlots.map((slot) => slot.slotKey).sort(compareCodeUnitStrings),
      ),
    }),
  };
}

function allocatorIntervalsFromLiveness(
  intervals: ReturnType<typeof buildAArch64LiveIntervals>["intervals"],
  interference: ReturnType<typeof buildAArch64InterferenceGraph>,
  callLocationConstraints: readonly AArch64CallLocationConstraint[],
): readonly AArch64AllocatorInterval[] {
  const constraintsByVreg = constraintsByVirtualRegister(callLocationConstraints);
  return Object.freeze(
    intervals.flatMap((interval) =>
      interval.segments.map((segment) => ({
        liveRangeKey: interval.liveRangeKey,
        vreg: interval.vreg,
        registerClass: registerClassForAllocation(interval.registerClass),
        startOrder: segment.startOrder,
        endOrder: segment.endOrder,
        cutPoints: interval.cutPoints,
        physicalInterferences: interference.physicalInterferencesFor(interval.vreg),
        ...requiredPhysicalRegisterForSegment(segment, constraintsByVreg.get(interval.vreg)),
        noSpill: interval.noSpill,
      })),
    ),
  );
}

function allocationRegisterPools(target: AArch64BackendTargetSurface): {
  readonly gprs: readonly string[];
  readonly vectors: readonly string[];
  readonly fps: readonly string[];
} {
  const allocatable = target.registerModel.registers.filter(
    (register) => register.isAllocatable && target.registerModel.canAllocate(register.stableKey),
  );
  return Object.freeze({
    gprs: allocatableRegisterKeys(allocatable, (register) => /^x\d+$/.test(register.stableKey)),
    vectors: allocatableRegisterKeys(allocatable, (register) => /^v\d+$/.test(register.stableKey)),
    fps: allocatableRegisterKeys(allocatable, (register) => /^d\d+$/.test(register.stableKey)),
  });
}

function allocatableRegisterKeys(
  registers: readonly { readonly stableKey: string; readonly encodingNumber: number }[],
  predicate: (register: { readonly stableKey: string; readonly encodingNumber: number }) => boolean,
): readonly string[] {
  return Object.freeze(
    registers
      .filter(predicate)
      .sort((left, right) => {
        return (
          left.encodingNumber - right.encodingNumber ||
          compareCodeUnitStrings(left.stableKey, right.stableKey)
        );
      })
      .map((register) => register.stableKey),
  );
}

function machineCallSitesForFunction(
  functionKey: string,
  machineFunction: AArch64MachineFunction,
): readonly AArch64MachineCallSite[] {
  return Object.freeze(
    machineFunction.blocks.flatMap((block) =>
      [...block.instructions, ...(block.terminator === undefined ? [] : [block.terminator])]
        .map((instruction) => machineCallSiteForInstruction(functionKey, instruction))
        .filter((callSite): callSite is AArch64MachineCallSite => callSite !== undefined),
    ),
  );
}

function isPrivateClosedImageBoundary(
  record: { readonly caller: string; readonly callee: string },
  plan: AArch64ClosedImageBackendPlan,
): boolean {
  return plan.privateConventions.some(
    (convention) => convention.caller === record.caller && convention.callee === record.callee,
  );
}

function unavailableRegistersFromCallBoundaries(
  boundaries: readonly AArch64ReconciledCallBoundary[],
): readonly string[] {
  return uniqueSortedRegisters(
    boundaries.flatMap((boundary) => boundary.potentialVeneerClobberGprs),
  );
}

function livenessCallBoundaries(
  callSites: readonly AArch64MachineCallSite[],
  boundaries: readonly AArch64ReconciledCallBoundary[],
): NonNullable<Parameters<typeof buildAArch64LiveIntervals>[0]["callBoundaries"]> {
  const boundaryByCallKey = new Map(boundaries.map((boundary) => [boundary.callKey, boundary]));
  return Object.freeze(
    callSites.flatMap((callSite) => {
      const boundary = boundaryByCallKey.get(callSite.callKey);
      if (boundary === undefined) return [];
      return [
        Object.freeze({
          instructionId: callSite.instructionId,
          clobberedPhysicalRegisters: uniqueSortedRegisters([
            ...boundary.clobberedGprs,
            ...boundary.clobberedVectorRegisters,
          ]),
        }),
      ];
    }),
  );
}

function uniqueSortedRegisters(registers: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(registers)].sort(compareCodeUnitStrings));
}

function repairWorkItemForAllocationRequest(
  request: AArch64AllocationRepairRequest,
  intervals: readonly AArch64AllocatorInterval[],
  securityFacts: {
    readonly noSpillVregs: readonly number[];
    readonly wipeOnSpillVregs: readonly number[];
  },
): AArch64AllocationRepairWorkItem {
  const interval = intervals.find((candidate) => candidate.liveRangeKey === request.liveRangeKey);
  const vreg = interval?.vreg ?? vregFromLiveRangeKey(request.liveRangeKey);
  return {
    requestKey: request.liveRangeKey,
    vreg,
    kind: request.kind === "rematerialize" ? "rematerialize" : "spill",
    useSiteKey: request.liveRangeKey,
    widthBytes: widthBytesForRegisterClass(interval?.registerClass),
    alignmentBytes: widthBytesForRegisterClass(interval?.registerClass),
    noSpill: interval?.noSpill === true || securityFacts.noSpillVregs.includes(vreg),
    wipeOnExit: securityFacts.wipeOnSpillVregs.includes(vreg),
  };
}

function vregFromLiveRangeKey(liveRangeKey: string): number {
  const match = /^live-range:vreg:(\d+)$/.exec(liveRangeKey);
  return match === null ? -1 : Number(match[1]);
}

function widthBytesForRegisterClass(
  registerClass: AArch64BackendRegisterClass | AArch64RegisterClass | undefined,
): number {
  switch (registerClass) {
    case "vector128":
      return 16;
    case "vector64":
    case "gpr64":
    case "fp":
    case "fpScalar":
      return 8;
    case "gpr32":
    case undefined:
      return 4;
  }
}

function noSpillVirtualRegisters(factIndex: AArch64BackendFactIndex): readonly number[] {
  return Object.freeze(
    factIndex.security
      .noSpillFacts()
      .flatMap((fact) => (fact.subject.kind === "virtualRegister" ? [fact.subject.vreg] : []))
      .sort((left, right) => left - right),
  );
}

function wipeOnSpillVirtualRegisters(factIndex: AArch64BackendFactIndex): readonly number[] {
  return Object.freeze(
    factIndex
      .factsForFamily("security.wipe-on-spill")
      .flatMap((fact) => (fact.subject.kind === "virtualRegister" ? [fact.subject.vreg] : []))
      .sort((left, right) => left - right),
  );
}

function abiValuesForMachineParameters(
  machineFunction: AArch64MachineFunction | undefined,
): readonly AArch64MachineAbiValue[] {
  if (machineFunction === undefined) return Object.freeze([]);
  return Object.freeze(
    machineFunction.parameters.map((parameter) =>
      abiValueForMachineLocation(parameter.valueKey, parameter.location),
    ),
  );
}

function abiValuesForMachineReturns(
  machineFunction: AArch64MachineFunction | undefined,
): readonly AArch64MachineAbiValue[] {
  if (machineFunction === undefined) return Object.freeze([]);
  return Object.freeze(
    machineFunction.returns.map((location, index) =>
      abiValueForMachineLocation(`return.${index}`, location),
    ),
  );
}

function abiValueForMachineLocation(
  key: string,
  location: AArch64MachineAbiLocation,
): AArch64MachineAbiValue {
  if (location.kind === "intReg") {
    return Object.freeze({
      key,
      kind: "integer",
      sizeBytes: 8,
      alignmentBytes: 8,
      fixedRegister: `x${location.index}`,
    });
  }
  if (location.kind === "vectorReg") {
    return Object.freeze({
      key,
      kind: "simd",
      sizeBytes: 16,
      alignmentBytes: 16,
      fixedRegister: `v${location.index}`,
    });
  }
  if (location.kind === "indirectResultPointer") {
    return Object.freeze({
      key,
      kind: "aggregate",
      sizeBytes: 24,
      alignmentBytes: 8,
      fixedRegister: `x${location.index}`,
    });
  }
  return Object.freeze({
    key,
    kind: "integer",
    sizeBytes: location.size,
    alignmentBytes: location.alignment,
  });
}

function registerClassForAllocation(
  registerClass: AArch64RegisterClass,
): AArch64BackendRegisterClass {
  switch (registerClass) {
    case "gpr64":
    case "gpr32":
    case "vector128":
    case "vector64":
      return registerClass;
    case "fpScalar":
      return "fp";
  }
}
