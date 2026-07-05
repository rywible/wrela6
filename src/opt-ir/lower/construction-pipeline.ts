import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../program";
import { type InternalConstructOptIrInput } from "../internal-construction-api";
import {
  importCheckedFactPacketIntoOptIrFactSet,
  optIrFactSetFromRecords,
  type OptIrFactSet,
} from "../facts/fact-index";
import { authenticatedLayoutFactKeys } from "../layout-fact-keys";
import { lowerCheckedMirProgram } from "./lower-checked-mir";
import type { OptIrValidatedBufferFactForLowering } from "./validated-buffer-lowering";
import { filterImportedFactsAfterProofErasure } from "./construction-fact-filter";
import {
  eraseProofOnlyOptIr,
  mergeProofErasureProvenances,
  type OptIrProofErasureProvenance,
} from "./proof-erasure";
import { runConstructionCleanup } from "../passes/cleanup";
import { lowerZeroSizedResultOperations } from "../passes/zero-sized-operation-lowering";
import { verifyOptIrProgram } from "../verify/structural-verifier";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import {
  optIrFactId,
  optIrPathCertificateId,
  type OptIrFunctionId,
  type OptIrOriginId,
} from "../ids";
import type { OptIrOperation } from "../operations";
import { stableDigestHex } from "../../shared/stable-json";
import { targetId } from "../../semantic/ids";
import type {
  ConstructedOptIrProgram,
  ConstructedOptIrProvenanceSnapshot,
  ConstructOptIrResult,
} from "../construction-results";
import type { CheckedFactDependency } from "../../proof-check/model/fact-packet";

export function runOptIrConstructionPipeline(
  input: InternalConstructOptIrInput,
): ConstructOptIrResult {
  const factImport = importCheckedFactPacketIntoOptIrFactSet({
    handoff: input.handoff,
    packet: input.handoff.checkedMir.facts,
    proofMirLookups: proofMirLookups(input),
    layoutFacts: {
      keys: authenticatedLayoutFactKeys(input.layoutFacts.facts),
      fingerprint: input.layoutFacts.fingerprint,
    },
  });
  if (factImport.kind === "error") {
    return { kind: "error", diagnostics: factImport.diagnostics };
  }

  const lowering = lowerCheckedMirProgram({
    checkedMir: input.handoff.checkedMir,
    target: input.target,
    validatedBufferFacts: validatedBufferFactsForLowering(factImport.factSet),
    nextGeneratedFactId: nextGeneratedFactId(factImport.factSet),
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
  const loweredProgramWithSummaries = attachCheckedFunctionSummaries(loweredProgram, input.handoff);

  const erasure = runPerFunctionOperationPass({
    program: loweredProgramWithSummaries,
    operations: lowering.operations,
    transform: (function_, operations) => {
      // Imported facts are preserved program-wide via construction-fact-filter.ts.
      const erasure = eraseProofOnlyOptIr({
        function: function_,
        operations,
        facts: [],
        factImportCompleted: true,
        proofOnlyValueIds: lowering.proofOnlyValueIds,
        proofOnlyOperationIds: proofOnlyOperationIdsForFunction(operations),
      });
      if (erasure.kind === "error") {
        return erasure;
      }
      return {
        kind: "ok" as const,
        function: erasure.function,
        operations: erasure.operations,
        proofErasureProvenance: erasure.provenance,
      };
    },
  });
  if (erasure.kind === "error") {
    return erasure;
  }

  const zeroSizedAggregates = runPerFunctionOperationPass({
    program: erasure.program,
    operations: erasure.operations,
    transform: (function_, operations) => {
      const lowered = lowerZeroSizedResultOperations({ operations });
      return { kind: "ok" as const, function: function_, operations: lowered.operations };
    },
  });
  if (zeroSizedAggregates.kind === "error") {
    return zeroSizedAggregates;
  }

  const cleanup = runPerFunctionOperationPass({
    program: zeroSizedAggregates.program,
    operations: zeroSizedAggregates.operations,
    transform: (function_, operations) => {
      const cleanup = runConstructionCleanup({
        function: function_,
        operations,
        facts: [],
      });
      return { kind: "ok" as const, function: cleanup.function, operations: cleanup.operations };
    },
  });
  if (cleanup.kind === "error") {
    return cleanup;
  }

  const factsBeforeProofErasure = optIrFactSetFromRecords([
    ...factImport.factSet.records,
    ...lowering.generatedFacts,
  ]);
  const facts = filterImportedFactsAfterProofErasure(factsBeforeProofErasure, lowering);
  const operations = sortedOperations(cleanup.operations);
  const optimizationRegions = Object.freeze(
    [...lowering.regions].sort((left, right) => left.regionId - right.regionId),
  );
  const verifiedProgram = withProvenanceSnapshot(cleanup.program);
  const operationTable = buildConstructionOperationTable(operations);
  if (operationTable.kind === "error") {
    return { kind: "error", diagnostics: operationTable.diagnostics };
  }
  const verifier = verifyOptIrProgram({
    program: verifiedProgram,
    operations: operationTable.operations,
    options: { checkDominance: true, recomputeOperationMetadata: true },
  });
  if (verifier.kind === "error") {
    return { kind: "error", diagnostics: verifier.diagnostics };
  }

  return {
    kind: "ok",
    program: verifiedProgram,
    operations,
    optimizationRegions,
    facts,
    provenance: snapshotProvenance(verifiedProgram.provenance.originIds),
    proofErasureProvenance: erasure.proofErasureProvenance ?? mergeProofErasureProvenances([]),
    diagnostics:
      input.options?.recordConstructionTrace === true
        ? [
            constructionDiagnostic(
              "OPT_IR_CONSTRUCTION_TRACE",
              "constructOptIr",
              "construction-cleanup",
              "construction-cleanup",
              "info",
            ),
          ]
        : [],
  };
}

function attachCheckedFunctionSummaries(
  program: OptIrProgram,
  handoff: InternalConstructOptIrInput["handoff"],
): OptIrProgram {
  const policiesByFunction = new Map(
    handoff.semanticInlinePolicies.map((policy) => [policy.functionInstanceId, policy] as const),
  );
  const externalRootsByFunction = new Map(
    handoff.checkedMir.mir.image.externalRoots.map(
      (externalRoot) => [externalRoot.functionInstanceId, externalRoot] as const,
    ),
  );
  return optIrProgram({
    ...program,
    functions: optIrFunctionTable(
      program.functions.entries().map((function_) => {
        const checkedSummary = handoff.checkedMir.summaries.get(function_.monoInstanceId);
        const policy = policiesByFunction.get(function_.monoInstanceId);
        const externalRoot = externalRootsByFunction.get(function_.monoInstanceId);
        if (checkedSummary === undefined && policy === undefined && externalRoot === undefined) {
          return function_;
        }
        return {
          ...function_,
          ...(externalRoot === undefined
            ? {}
            : {
                externalRoot: Object.freeze({
                  reason: externalRoot.reason,
                  originId: function_.originId,
                }),
              }),
          ...(checkedSummary === undefined
            ? {}
            : {
                summary: Object.freeze({
                  ...checkedSummary,
                  ...(policy === undefined
                    ? {}
                    : {
                        semanticInlinePolicy: Object.freeze({
                          kind: policy.kind,
                          reason: policy.reason,
                          source: policy.source,
                          certificateId: policy.summaryCertificateId,
                          summaryCertificateId: policy.summaryCertificateId,
                        }),
                      }),
                }),
              }),
        };
      }),
    ),
  });
}

function runPerFunctionOperationPass(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly transform: (
    function_: OptIrFunction,
    operations: readonly OptIrOperation[],
  ) =>
    | {
        readonly kind: "ok";
        readonly function: OptIrFunction;
        readonly operations: readonly OptIrOperation[];
        readonly proofErasureProvenance?: OptIrProofErasureProvenance;
      }
    | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };
}):
  | {
      readonly kind: "ok";
      readonly program: OptIrProgram;
      readonly operations: readonly OptIrOperation[];
      readonly proofErasureProvenance?: OptIrProofErasureProvenance;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  const operationBuckets = bucketOperationsByFunction(input.program, input.operations);
  const functions: OptIrFunction[] = [];
  const proofErasureParts: OptIrProofErasureProvenance[] = [];

  for (const function_ of input.program.functions.entries()) {
    const functionOperations = operationBuckets.get(function_.functionId) ?? [];
    const result = input.transform(function_, functionOperations);
    if (result.kind === "error") {
      return result;
    }
    functions.push(result.function);
    operationBuckets.set(function_.functionId, [...result.operations]);
    if (result.proofErasureProvenance !== undefined) {
      proofErasureParts.push(result.proofErasureProvenance);
    }
  }

  return {
    kind: "ok",
    program: optIrProgram({
      ...input.program,
      functions: optIrFunctionTable(functions),
    }),
    operations: sortedOperations(flattenOperationBuckets(input.program, operationBuckets)),
    ...(proofErasureParts.length > 0
      ? { proofErasureProvenance: mergeProofErasureProvenances(proofErasureParts) }
      : {}),
  };
}

function bucketOperationsByFunction(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
): Map<OptIrFunctionId, OptIrOperation[]> {
  const ownership = operationOwnershipByFunction(program);
  const buckets = new Map<OptIrFunctionId, OptIrOperation[]>(
    program.functions.entries().map((function_) => [function_.functionId, []]),
  );
  for (const operation of operations) {
    const functionId = ownership.get(operation.operationId);
    if (functionId === undefined) {
      continue;
    }
    buckets.get(functionId)?.push(operation);
  }
  return buckets;
}

function operationOwnershipByFunction(
  program: OptIrProgram,
): ReadonlyMap<OptIrOperation["operationId"], OptIrFunctionId> {
  const ownership = new Map<OptIrOperation["operationId"], OptIrFunctionId>();
  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks) {
      for (const operationId of block.operations) {
        ownership.set(operationId, function_.functionId);
      }
    }
  }
  return ownership;
}

function flattenOperationBuckets(
  program: OptIrProgram,
  buckets: ReadonlyMap<OptIrFunctionId, readonly OptIrOperation[]>,
): readonly OptIrOperation[] {
  const operations: OptIrOperation[] = [];
  for (const function_ of program.functions.entries()) {
    operations.push(...(buckets.get(function_.functionId) ?? []));
  }
  return operations;
}

function loweringDiagnostic(detail: string): OptIrDiagnostic {
  if (detail.endsWith(":missing-block")) {
    return constructionDiagnostic("OPT_IR_INPUT_CONTRACT_INVALID", "checked-mir", detail, detail);
  }
  return constructionDiagnostic(
    "OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION",
    "checked-mir",
    detail,
    detail,
  );
}

function proofOnlyOperationIdsForFunction(
  operations: readonly OptIrOperation[],
): readonly OptIrOperation["operationId"][] {
  return operations
    .filter((operation) => operation.kind === "proofErasedMarker")
    .map((operation) => operation.operationId);
}

export function buildConstructionOperationTable(operations: readonly OptIrOperation[]):
  | {
      readonly kind: "ok";
      readonly operations: ReadonlyMap<OptIrOperation["operationId"], OptIrOperation>;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  const byId = new Map<OptIrOperation["operationId"], OptIrOperation>();
  for (const operation of operations) {
    if (byId.has(operation.operationId)) {
      const stableDetail = `operation-table:duplicate-operation-id:${Number(operation.operationId)}`;
      return {
        kind: "error",
        diagnostics: [
          constructionDiagnostic(
            "OPT_IR_INPUT_CONTRACT_INVALID",
            "constructOptIr",
            stableDetail,
            stableDetail,
          ),
        ],
      };
    }
    byId.set(operation.operationId, operation);
  }
  return { kind: "ok", operations: byId };
}

function sortedOperations(operations: readonly OptIrOperation[]): readonly OptIrOperation[] {
  return Object.freeze([...operations].sort((left, right) => left.operationId - right.operationId));
}

function validatedBufferFactsForLowering(
  factSet: OptIrFactSet,
): readonly OptIrValidatedBufferFactForLowering[] {
  return Object.freeze(
    factSet.records
      .filter((record) => record.packetKind === "validatedBuffer")
      .flatMap((record) => {
        if (record.subject.kind !== "place") {
          return [];
        }
        const layoutKey = record.dependencies.find(
          (
            dependency,
          ): dependency is Extract<CheckedFactDependency, { readonly kind: "layoutFact" }> =>
            dependency.kind === "layoutFact",
        )?.layoutKey;
        if (layoutKey === undefined) {
          return [];
        }
        return [
          {
            sourcePlace: record.subject.placeId,
            layoutKey,
            factId: record.factId,
            ...(record.scope.kind === "path"
              ? { pathCertificateId: optIrPathCertificateId(Number(record.scope.certificateId)) }
              : {}),
          },
        ];
      })
      .sort((left, right) => left.factId - right.factId),
  );
}

function nextGeneratedFactId(factSet: OptIrFactSet) {
  const maxFactId = factSet.records.reduce(
    (max, record) => Math.max(max, Number(record.factId)),
    -1,
  );
  return optIrFactId(maxFactId + 1);
}

function withProvenanceSnapshot(program: OptIrProgram): ConstructedOptIrProgram {
  return {
    ...program,
    provenance: snapshotProvenance(program.provenance.originIds),
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

function proofMirLookups(input: InternalConstructOptIrInput) {
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
    callSubjects: input.handoff.checkedMir.mir.callGraph.entries().map((edge) => ({
      functionInstanceId: edge.callId.functionInstanceId,
      callId: edge.callId.callId,
    })),
    facts: input.handoff.checkedMir.mir.facts.entries().map((fact) => fact.factId),
    origins: input.handoff.checkedMir.mir.origins.entries().map((origin) => origin.originId),
    privateGenerations: input.handoff.checkedMir.mir.privateStateGenerations
      .entries()
      .map((generation) => generation.generationId),
  };
}

function constructionDiagnostic(
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
