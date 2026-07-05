import { compareOptIrSlicesForTest } from "./opt-ir-differential";
import { fakeOptIrEffectTraceForTest, fakeOptIrMemoryForTest } from "./opt-ir-interpreter";
import type { OptIrDifferentialComparison } from "../../../src/opt-ir/differential";
import {
  interpretOptIrSlice,
  validateOptIrSliceIsInterpreterComplete,
  type OptIrInterpreterSlice,
  type OptIrRuntimeValue,
} from "../../../src/opt-ir/interpreter";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import type { OptIrProgram } from "../../../src/opt-ir/program";
import {
  authenticateUefiAArch64TargetDriverSurface,
  runUefiAArch64PackagePipelineToOptIr,
  type FixtureProjectFilesystem,
  type UefiAArch64TargetDriverSurface,
} from "../../../src/target/uefi-aarch64";
import {
  fullImageValidationCaseKey,
  packageInputForFullImageFixture,
  type FullImageValidationFixtureSpec,
} from "../../../src/validation/full-image";
import { uefiTargetSurfaceFixture } from "../target/uefi-aarch64/uefi-aarch64-fixtures";

export interface FixtureOptIrObservationLoadInput {
  readonly spec: FullImageValidationFixtureSpec;
  readonly filesystem: FixtureProjectFilesystem;
  readonly target?: UefiAArch64TargetDriverSurface;
}

export interface FixtureOptIrObservationInput {
  readonly caseKey: string;
  readonly slices: readonly FixtureOptIrComparableSlice[];
}

export interface FixtureOptIrComparableSlice {
  readonly functionKey: string;
  readonly unoptimized: OptIrInterpreterSlice;
  readonly optimized: OptIrInterpreterSlice;
  readonly unoptimizedObservation: FixtureOptIrObservation;
  readonly optimizedObservation: FixtureOptIrObservation;
}

export type FixtureOptIrObservation =
  | {
      readonly exitStatus: "returned";
      readonly values: readonly OptIrRuntimeValue[];
      readonly memory: readonly (readonly [string, OptIrRuntimeValue])[];
      readonly effects: readonly string[];
    }
  | { readonly exitStatus: "trapped"; readonly reason: string };

export function loadFixtureOptIrObservationInputForTest(
  input: FixtureOptIrObservationLoadInput,
): FixtureOptIrObservationInput {
  const packageInput = packageInputForFullImageFixture(input.spec, input.filesystem);
  if (packageInput.kind === "error") {
    throw new Error(
      `full-image fixture package input failed for ${fullImageValidationCaseKey(input.spec)}`,
    );
  }

  const pipeline = runUefiAArch64PackagePipelineToOptIr({
    packageInput: packageInput.value,
    target: input.target ?? targetSurfaceForFixture(),
  });
  if (pipeline.kind === "error") {
    throw new Error(
      `full-image fixture OptIR pipeline failed for ${fullImageValidationCaseKey(input.spec)}: ${pipeline.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }

  const unoptimizedProgram = pipeline.value.optimizedOptIr.constructOptIrResult.program;
  const unoptimizedOperations =
    unoptimizedProgram.operations ?? pipeline.value.optimizedOptIr.unoptimizedOperations;
  const optimizedProgram = pipeline.value.optIr.program;
  const optimizedOperations = pipeline.value.optIr.operations;
  const optimizedFunctionsById = new Map(
    optimizedProgram.functions
      .entries()
      .map((function_) => [String(function_.functionId), function_]),
  );
  const slices: FixtureOptIrComparableSlice[] = [];

  for (const unoptimizedFunction of unoptimizedProgram.functions.entries()) {
    const functionKey = String(unoptimizedFunction.functionId);
    const optimizedFunction = optimizedFunctionsById.get(functionKey);
    if (optimizedFunction === undefined) {
      continue;
    }
    const unoptimized = sliceForFunction(unoptimizedProgram, unoptimizedOperations, functionKey);
    const optimized = sliceForFunction(optimizedProgram, optimizedOperations, functionKey);
    if (
      validateOptIrSliceIsInterpreterComplete(unoptimized).kind !== "complete" ||
      validateOptIrSliceIsInterpreterComplete(optimized).kind !== "complete"
    ) {
      continue;
    }
    slices.push(
      Object.freeze({
        functionKey,
        unoptimized,
        optimized,
        unoptimizedObservation: observeOptIrSliceForTest(unoptimized),
        optimizedObservation: observeOptIrSliceForTest(optimized),
      }),
    );
  }

  if (slices.length === 0) {
    throw new Error(
      `full-image fixture has no interpreter-complete unoptimized/optimized OptIR slice: ${fullImageValidationCaseKey(
        input.spec,
      )}`,
    );
  }

  return Object.freeze({
    caseKey: fullImageValidationCaseKey(input.spec),
    slices: Object.freeze(slices),
  });
}

function targetSurfaceForFixture(): UefiAArch64TargetDriverSurface {
  const result = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  if (result.kind === "error") {
    throw new Error(
      `fixture target surface failed authentication: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }
  return result.value;
}

export function compareFixtureOptIrObservationsForTest(
  input: FixtureOptIrObservationInput,
): OptIrDifferentialComparison {
  const differences: string[] = [];
  const rejectionReasons: string[] = [];
  for (const slice of input.slices) {
    const comparison = compareOptIrSlicesForTest({
      before: slice.unoptimized,
      after: slice.optimized,
      memoryFactory: fakeOptIrMemoryForTest,
      effectTraceFactory: fakeOptIrEffectTraceForTest,
    });
    if (comparison.kind === "different") {
      differences.push(
        ...comparison.differences.map(
          (difference) => `${input.caseKey}:function:${slice.functionKey}:${difference}`,
        ),
      );
    }
    if (comparison.kind === "rejected") {
      rejectionReasons.push(
        ...comparison.reasons.map(
          (reason) => `${input.caseKey}:function:${slice.functionKey}:${reason}`,
        ),
      );
    }
  }

  if (rejectionReasons.length > 0) {
    return { kind: "rejected", reasons: Object.freeze([...new Set(rejectionReasons)].sort()) };
  }
  return differences.length === 0
    ? { kind: "equivalent" }
    : { kind: "different", differences: Object.freeze(differences.sort()) };
}

function observeOptIrSliceForTest(slice: OptIrInterpreterSlice): FixtureOptIrObservation {
  const result = interpretOptIrSlice({
    slice,
    memory: fakeOptIrMemoryForTest(),
    effects: fakeOptIrEffectTraceForTest(),
  });
  if (result.kind === "trapped") {
    return Object.freeze({ exitStatus: "trapped", reason: result.reason });
  }
  return Object.freeze({
    exitStatus: "returned" as const,
    values: Object.freeze([...result.values]),
    memory: Object.freeze([...result.observations.memory]),
    effects: Object.freeze([...result.observations.effects]),
  });
}

function sliceForFunction(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
  functionKey: string,
): OptIrInterpreterSlice {
  const function_ = program.functions
    .entries()
    .find((candidate) => String(candidate.functionId) === functionKey);
  if (function_ === undefined) {
    throw new Error(`missing OptIR function:${functionKey}`);
  }
  const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const referencedOperations = function_.blocks.flatMap((block) =>
    block.operations.map((operationId) => {
      const operation = operationsById.get(operationId);
      if (operation === undefined) {
        throw new Error(`missing OptIR operation:${operationId}`);
      }
      return operation;
    }),
  );
  return Object.freeze({
    entryBlock: function_.entryBlock,
    blocks: Object.freeze([...function_.blocks]),
    edges: function_.edges,
    operations: Object.freeze(referencedOperations),
  });
}
