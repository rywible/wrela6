import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "./program";
import { validateOptIrConstructionBoundary } from "./boundary-validation";
import { type InternalConstructOptIrInput } from "./internal-construction-api";
import { importCheckedFactPacketIntoOptIrFactSet, type OptIrFactSet } from "./facts/fact-index";
import { lowerCheckedMirProgram } from "./lower/lower-checked-mir";
import { runConstructionCleanup } from "./passes/cleanup";
import { verifyOptIrProgram } from "./verify/structural-verifier";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "./diagnostics";
import type { OptIrOriginId } from "./ids";
import type { OptIrOperation } from "./operations";
import type { OptIrRegion } from "./regions";
import {
  optimizeOptIr,
  type OptimizeOptIrInput,
  type OptimizeOptIrResult,
} from "./passes/pipeline";
import type { OptIrOptimizationPolicy } from "./policy/optimization-profile";
import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
import { targetId } from "../semantic/ids";

export type ConstructOptIrInput = InternalConstructOptIrInput;

export interface ConstructedOptIrProvenanceSnapshot {
  readonly originIds: readonly OptIrOriginId[];
  readonly fingerprint: ProofAuthorityFingerprint;
}

export type ConstructedOptIrProgram = Omit<OptIrProgram, "provenance"> & {
  readonly provenance: ConstructedOptIrProvenanceSnapshot;
  readonly operations?: readonly OptIrOperation[];
  readonly optimizationRegions?: readonly OptIrRegion[];
};

export type ConstructOptIrResult =
  | {
      readonly kind: "ok";
      readonly program: ConstructedOptIrProgram;
      readonly facts: OptIrFactSet;
      readonly provenance: ConstructedOptIrProvenanceSnapshot;
      readonly diagnostics: readonly OptIrDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface BuildOptimizedOptIrInput extends ConstructOptIrInput {
  readonly policy: OptIrOptimizationPolicy;
}

export interface BuildOptimizedOptIrDependencies {
  readonly optimizer?: (input: OptimizeOptIrInput) => OptimizeOptIrResult;
}

export function constructOptIr(input: ConstructOptIrInput): ConstructOptIrResult {
  const boundary = validateOptIrConstructionBoundary(input);
  if (boundary.kind === "error") {
    return { kind: "error", diagnostics: boundary.diagnostics };
  }

  const factImport = importCheckedFactPacketIntoOptIrFactSet({
    handoff: input.handoff,
    packet: input.handoff.checkedMir.facts,
    proofMirLookups: proofMirLookups(input),
    layoutFacts: {
      keys: layoutFactKeys(input.layoutFacts.facts),
      fingerprint: input.layoutFacts.fingerprint,
    },
  });
  if (factImport.kind === "error") {
    return { kind: "error", diagnostics: factImport.diagnostics };
  }

  const lowering = lowerCheckedMirProgram({
    checkedMir: input.handoff.checkedMir,
    targetId: input.target.targetId,
  });
  if (lowering.kind === "error") {
    return {
      kind: "error",
      diagnostics: lowering.diagnostics.map((detail) => loweringDiagnostic(detail)),
    };
  }

  const loweredProgram = optIrProgram({
    ...lowering.program,
    functions: lowering.program.functions,
    regions: optIrRegionTable(lowering.program.regions.entries()),
    constants: optIrConstantTable(lowering.program.constants.entries()),
  });
  let operations = sortedOperations(lowering.operations);
  const cleanedFunctions: OptIrFunction[] = [];

  for (const function_ of loweredProgram.functions.entries()) {
    const cleanup = runConstructionCleanup({
      function: function_,
      operations: operationsForFunction(function_, operations),
      facts: [],
    });
    cleanedFunctions.push(cleanup.function);
    operations = sortedOperations([
      ...operations.filter(
        (operation) => !functionOwnsOperationId(function_, operation.operationId),
      ),
      ...cleanup.operations,
    ]);
  }

  const cleanedProgram = optIrProgram({
    ...loweredProgram,
    functions: optIrFunctionTable(cleanedFunctions),
  });

  const verifiedProgram = withProvenanceSnapshot(cleanedProgram, operations);
  const verifier = verifyOptIrProgram({
    program: verifiedProgram,
    operations: operationMap(operations),
    options: { checkDominance: true, recomputeOperationMetadata: true },
  });
  if (verifier.kind === "error") {
    return { kind: "error", diagnostics: verifier.diagnostics };
  }

  return {
    kind: "ok",
    program: verifiedProgram,
    facts: factImport.factSet,
    provenance: snapshotProvenance(verifiedProgram.provenance.originIds),
    diagnostics:
      input.options?.recordConstructionTrace === true
        ? [
            diagnostic(
              "OPT_IR_INPUT_CONTRACT_INVALID",
              "constructOptIr",
              "construction-cleanup",
              "construction-cleanup",
              "info",
            ),
          ]
        : [],
  };
}

export function buildOptimizedOptIr(
  input: BuildOptimizedOptIrInput,
  dependencies: BuildOptimizedOptIrDependencies = {},
): OptimizeOptIrResult {
  const construction = constructOptIr(input);
  if (construction.kind === "error") {
    return construction;
  }

  const optimizer = dependencies.optimizer ?? optimizeOptIr;
  const optimization = optimizer({
    program: construction.program,
    facts: construction.facts,
    target: input.target,
    policy: input.policy,
  });
  if (optimization.kind === "error") {
    return {
      kind: "error",
      diagnostics: [...construction.diagnostics, ...optimization.diagnostics],
    };
  }
  return {
    ...optimization,
    diagnostics: [...construction.diagnostics, ...optimization.diagnostics],
  };
}

function loweringDiagnostic(detail: string): OptIrDiagnostic {
  if (detail.endsWith(":missing-block")) {
    return diagnostic("OPT_IR_INPUT_CONTRACT_INVALID", "checked-mir", detail, detail);
  }
  return diagnostic("OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION", "checked-mir", detail, detail);
}

function operationsForFunction(
  function_: OptIrFunction,
  operations: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  return operations.filter((operation) =>
    functionOwnsOperationId(function_, operation.operationId),
  );
}

function functionOwnsOperationId(
  function_: OptIrFunction,
  operationId: OptIrOperation["operationId"],
): boolean {
  return function_.blocks.some((block) => block.operations.includes(operationId));
}

function operationMap(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperation["operationId"], OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

function sortedOperations(operations: readonly OptIrOperation[]): readonly OptIrOperation[] {
  return Object.freeze([...operations].sort((left, right) => left.operationId - right.operationId));
}

function withProvenanceSnapshot(
  program: OptIrProgram,
  operations: readonly OptIrOperation[] = [],
  optimizationRegions: readonly OptIrRegion[] = [],
): ConstructedOptIrProgram {
  return {
    ...program,
    provenance: snapshotProvenance(program.provenance.originIds),
    operations: sortedOperations(operations),
    optimizationRegions: Object.freeze(
      [...optimizationRegions].sort((left, right) => left.regionId - right.regionId),
    ),
  };
}

function snapshotProvenance(
  originIds: readonly OptIrOriginId[],
): ConstructedOptIrProvenanceSnapshot {
  const snapshot = Object.freeze([...originIds].sort((left, right) => left - right));
  return Object.freeze({
    originIds: snapshot,
    fingerprint: {
      authorityKind: "semantics" as const,
      targetId: targetId("opt-ir-provenance"),
      version: "opt-ir-construction-v1",
      digestAlgorithm: "sha256" as const,
      digestHex: stableDigestHex(snapshot),
    },
  });
}

function proofMirLookups(input: ConstructOptIrInput) {
  const functions = input.handoff.checkedMir.mir.functions.entries();
  return {
    places: functions.flatMap(
      (function_) => function_.places?.entries?.().map((place) => place.placeId) ?? [],
    ),
    values: functions.flatMap(
      (function_) => function_.values?.entries?.().map((value) => value.valueId) ?? [],
    ),
    edges: functions.flatMap(
      (function_) => function_.edges?.entries?.().map((edge) => edge.edgeId) ?? [],
    ),
    calls: [],
    facts: input.handoff.checkedMir.mir.facts.entries().map((fact) => fact.factId),
    origins: input.handoff.checkedMir.mir.origins.entries().map((origin) => origin.originId),
    privateGenerations: input.handoff.checkedMir.mir.privateStateGenerations
      .entries()
      .map((generation) => generation.generationId),
  };
}

function layoutFactKeys(facts: unknown): readonly string[] {
  return stableJson(facts).match(/layout:[A-Za-z0-9:_-]+/g) ?? [];
}

function diagnostic(
  code: Parameters<typeof optIrDiagnosticCode>[0],
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
  severity: OptIrDiagnostic["severity"] = "error",
): OptIrDiagnostic {
  const diagnosticCode = optIrDiagnosticCode(code);
  return {
    severity,
    code: diagnosticCode,
    messageTemplate: stableDetail,
    arguments: {},
    ownerKey,
    rootCauseKey,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code: diagnosticCode,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}

function stableDigestHex(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableJson(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(8);
}

function stableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [toStableValue(key), toStableValue(entry)] as const)
      .sort((left, right) => stableJson(left[0]).localeCompare(stableJson(right[0])));
  }
  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, toStableValue(entry)]),
    );
  }
  return value;
}
