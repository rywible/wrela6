import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { instantiatedHirIdKey } from "../../../src/mono/ids";
import type {
  MonoExpression,
  MonoFunctionInstance,
  MonoInstantiationEdge,
  MonoInstantiationEdgeSource,
  MonoStatement,
  MonomorphizedHirProgram,
} from "../../../src/mono/mono-hir";
import { proofMetadataIdKey } from "../../../src/mono/proof-metadata-tables";
import {
  genericFunctionWithObligationProgramForMonoTest,
  twoCallSitesSameGenericInstanceProgramForMonoTest,
} from "./monomorphization-fixtures";

type MonoWholeImageResult = ReturnType<typeof monomorphizeWholeImage>;

interface MonoTransformMigrationFunctionSummary {
  readonly instanceId: string;
  readonly sourceFunctionId: string;
  readonly bodySourceOrigin?: string;
  readonly statementIds: readonly string[];
  readonly statementOrigins: readonly string[];
  readonly expressionIds: readonly string[];
  readonly expressionOrigins: readonly string[];
}

interface MonoTransformMigrationProofMetadataSummary {
  readonly obligationIds: readonly string[];
  readonly resourcePlaceIds: readonly string[];
  readonly terminalCallIds: readonly string[];
  readonly validationIds: readonly string[];
  readonly attemptIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly callSiteRequirementIds: readonly string[];
  readonly counts: {
    readonly obligations: number;
    readonly resourcePlaces: number;
    readonly terminalCalls: number;
    readonly validations: number;
    readonly attempts: number;
    readonly sessions: number;
    readonly callSiteRequirements: number;
  };
}

export interface MonoTransformMigrationSummary {
  readonly label: string;
  readonly functionInstanceIds: readonly string[];
  readonly functions: readonly MonoTransformMigrationFunctionSummary[];
  readonly graphEdges: readonly string[];
  readonly proofMetadata: MonoTransformMigrationProofMetadataSummary;
}

function expectMonoOk(label: string, result: MonoWholeImageResult): MonomorphizedHirProgram {
  if (result.kind !== "ok") {
    throw new Error(
      `${label} monomorphization failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(",")}`,
    );
  }
  return result.program;
}

export function monoTransformMigrationGenericProgramForTest(): MonomorphizedHirProgram {
  return expectMonoOk(
    "generic-call",
    monomorphizeWholeImage({
      program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
    }),
  );
}

export function monoTransformMigrationProofProgramForTest(): MonomorphizedHirProgram {
  return expectMonoOk(
    "proof-metadata",
    monomorphizeWholeImage({
      program: genericFunctionWithObligationProgramForMonoTest(),
    }),
  );
}

export function monoTransformMigrationSummariesForTest(): readonly MonoTransformMigrationSummary[] {
  return [
    monoTransformMigrationSummaryForTest({
      label: "generic-call",
      program: monoTransformMigrationGenericProgramForTest(),
    }),
    monoTransformMigrationSummaryForTest({
      label: "proof-metadata",
      program: monoTransformMigrationProofProgramForTest(),
    }),
  ];
}

function monoTransformMigrationSummaryForTest(input: {
  readonly label: string;
  readonly program: MonomorphizedHirProgram;
}): MonoTransformMigrationSummary {
  const functions = sortStringsBy(input.program.functions.entries(), (function_) =>
    String(function_.instanceId),
  ).map(monoTransformMigrationFunctionSummary);

  return {
    label: input.label,
    functionInstanceIds: functions.map((function_) => function_.instanceId),
    functions,
    graphEdges: input.program.instantiationGraph.edges.map(graphEdgeSummary).sort(),
    proofMetadata: proofMetadataSummary(input.program),
  };
}

function monoTransformMigrationFunctionSummary(
  function_: MonoFunctionInstance,
): MonoTransformMigrationFunctionSummary {
  const statements = sortedBodyIndexEntries(function_.bodyIndex?.statements.entries() ?? []);
  const expressions = sortedBodyIndexEntries(function_.bodyIndex?.expressions.entries() ?? []);

  return {
    instanceId: String(function_.instanceId),
    sourceFunctionId: String(function_.sourceFunctionId),
    ...(function_.body !== undefined ? { bodySourceOrigin: function_.body.sourceOrigin } : {}),
    statementIds: statements.map((statement) => instantiatedHirIdKey(statement.statementId)),
    statementOrigins: statements.map(statementOriginSummary),
    expressionIds: expressions.map((expression) => instantiatedHirIdKey(expression.expressionId)),
    expressionOrigins: expressions.map(expressionOriginSummary),
  };
}

function sortedBodyIndexEntries<Entry extends MonoStatement | MonoExpression>(
  entries: readonly Entry[],
): readonly Entry[] {
  return sortStringsBy(entries, (entry) =>
    "statementId" in entry
      ? instantiatedHirIdKey(entry.statementId)
      : instantiatedHirIdKey(entry.expressionId),
  );
}

function statementOriginSummary(statement: MonoStatement): string {
  return `${instantiatedHirIdKey(statement.statementId)}@${statement.sourceOrigin}`;
}

function expressionOriginSummary(expression: MonoExpression): string {
  return `${instantiatedHirIdKey(expression.expressionId)}@${expression.sourceOrigin}`;
}

function graphEdgeSummary(edge: MonoInstantiationEdge): string {
  return `${graphEdgeSourceSummary(edge.source)} -> ${edge.targetKind}:${String(
    edge.targetInstanceId,
  )}@${edge.sourceOrigin}`;
}

function graphEdgeSourceSummary(source: MonoInstantiationEdgeSource): string {
  switch (source.kind) {
    case "image":
      return `image:${String(source.imageId)}`;
    case "function":
      return `function:${String(source.instanceId)}${
        source.callExpressionId !== undefined
          ? `/call:${instantiatedHirIdKey(source.callExpressionId)}`
          : ""
      }`;
    case "type":
      return `type:${String(source.instanceId)}${
        source.fieldId !== undefined ? `/field:${String(source.fieldId)}` : ""
      }`;
  }
}

function proofMetadataSummary(
  program: MonomorphizedHirProgram,
): MonoTransformMigrationProofMetadataSummary {
  const obligationIds = proofMetadataKeys(program.proofMetadata.obligations.entries(), (entry) =>
    proofMetadataIdKey(entry.obligationId),
  );
  const resourcePlaceIds = proofMetadataKeys(
    program.proofMetadata.resourcePlaces.entries(),
    (entry) => proofMetadataIdKey(entry.placeId),
  );
  const terminalCallIds = proofMetadataKeys(
    program.proofMetadata.terminalCalls.entries(),
    (entry) => proofMetadataIdKey(entry.terminalCallId),
  );
  const validationIds = proofMetadataKeys(program.proofMetadata.validations.entries(), (entry) =>
    proofMetadataIdKey(entry.validationId),
  );
  const attemptIds = proofMetadataKeys(program.proofMetadata.attempts.entries(), (entry) =>
    proofMetadataIdKey(entry.attemptId),
  );
  const sessionIds = proofMetadataKeys(program.proofMetadata.sessions.entries(), (entry) =>
    proofMetadataIdKey(entry.sessionId),
  );
  const callSiteRequirementIds = proofMetadataKeys(
    program.proofMetadata.callSiteRequirements.entries(),
    (entry) => proofMetadataIdKey(entry.callSiteRequirementId),
  );

  return {
    obligationIds,
    resourcePlaceIds,
    terminalCallIds,
    validationIds,
    attemptIds,
    sessionIds,
    callSiteRequirementIds,
    counts: {
      obligations: obligationIds.length,
      resourcePlaces: resourcePlaceIds.length,
      terminalCalls: terminalCallIds.length,
      validations: validationIds.length,
      attempts: attemptIds.length,
      sessions: sessionIds.length,
      callSiteRequirements: callSiteRequirementIds.length,
    },
  };
}

function proofMetadataKeys<Entry>(
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
): readonly string[] {
  return entries.map(keyOf).sort();
}

function sortStringsBy<Entry>(entries: readonly Entry[], keyOf: (entry: Entry) => string): Entry[] {
  return [...entries].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}
