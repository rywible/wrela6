import type { ProofMirDiagnostic } from "../../../src/proof-mir/diagnostics";
import { sortProofMirDiagnostics } from "../../../src/proof-mir/diagnostics";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { ProofMirBuildInput } from "./proof-mir-build-input";

function sortDiagnosticsForSummary(diagnostics: readonly ProofMirDiagnostic[]): unknown {
  return sortProofMirDiagnostics(diagnostics).map((diagnostic) => stableSummaryValue(diagnostic));
}

function stableSummaryValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "function") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stableSummaryValue);
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [stableSummaryValue(key), stableSummaryValue(entryValue)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (value instanceof Set) {
    return [...value.values()]
      .map(stableSummaryValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value !== null && typeof value === "object") {
    if ("entries" in value && typeof value.entries === "function") {
      return stableSummaryValue((value as { entries: () => readonly unknown[] }).entries());
    }
    if ("originRecords" in value && typeof value.originRecords === "function") {
      return stableSummaryValue(
        (value as { originRecords: () => readonly unknown[] }).originRecords(),
      );
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableSummaryValue(entryValue)]),
    );
  }
  return value;
}

function proofMirProgramSummary(program: ProofMirProgram): unknown {
  return stableSummaryValue({
    image: program.image,
    functions: program.functions.entries(),
    layout: {
      target: program.layout.target,
      types: program.layout.types.entries(),
      fields: program.layout.fields.entries(),
      enums: program.layout.enums.entries(),
      validatedBuffers: program.layout.validatedBuffers.entries(),
      imageDevices: program.layout.imageDevices.entries(),
      functions: program.layout.functions.entries(),
      platformEdges: program.layout.platformEdges.entries(),
      imageEntry: program.layout.imageEntry,
    },
    proofMetadata: {
      obligations: program.proofMetadata.obligations.entries(),
      sessions: program.proofMetadata.sessions.entries(),
      brands: program.proofMetadata.brands.entries(),
      resourcePlaces: program.proofMetadata.resourcePlaces.entries(),
      callSiteRequirements: program.proofMetadata.callSiteRequirements.entries(),
      validations: program.proofMetadata.validations.entries(),
      attempts: program.proofMetadata.attempts.entries(),
      terminalCalls: program.proofMetadata.terminalCalls.entries(),
      privateStateTransitions: program.proofMetadata.privateStateTransitions.entries(),
      factOrigins: program.proofMetadata.factOrigins.entries(),
      platformContractEdges: program.proofMetadata.platformContractEdges.entries(),
      imageOrigins: program.proofMetadata.imageOrigins.entries(),
    },
    origins: program.origins.entries(),
    facts: program.facts.entries(),
    layoutTerms: program.layoutTerms.entries(),
    privateStateGenerations: program.privateStateGenerations.entries(),
    callGraph: program.callGraph,
    platformEdges: program.platformEdges.entries(),
    runtimeCatalog: {
      targetId: program.runtimeCatalog.targetId,
      features: program.runtimeCatalog.features,
      operations: program.runtimeCatalog.entries().map((operation) => operation.name),
    },
    runtimeCalls: program.runtimeCalls.entries(),
  });
}

function proofMirBuildInputSummary(input: ProofMirBuildInput): unknown {
  return stableSummaryValue({
    program: {
      image: input.program.image,
      externalRoots: input.program.externalRoots,
      functions: input.program.functions.entries().map((func) => ({
        instanceId: func.instanceId,
        sourceFunctionId: func.sourceFunctionId,
        bodyStatus: func.bodyStatus,
        parameterNames: func.signature.parameters.map((parameter) => parameter.name),
      })),
      types: input.program.types.entries(),
      validatedBuffers: input.program.validatedBuffers.entries(),
      reachablePlatformPrimitiveIds: input.program.reachablePlatformPrimitiveIds,
      origins: input.program.origins.originRecords(),
    },
    layout: {
      target: input.layout.target,
      types: input.layout.types.entries(),
      fields: input.layout.fields.entries(),
      enums: input.layout.enums.entries(),
      validatedBuffers: input.layout.validatedBuffers.entries(),
      imageDevices: input.layout.imageDevices.entries(),
      functions: input.layout.functions.entries(),
      platformEdges: input.layout.platformEdges.entries(),
      imageEntry: input.layout.imageEntry,
    },
    target: {
      targetId: input.target.targetId,
      features: input.target.features,
      runtimeCatalog: {
        targetId: input.target.runtimeCatalog.targetId,
        features: input.target.runtimeCatalog.features,
        operations: input.target.runtimeCatalog.entries().map((operation) => operation.name),
      },
    },
  });
}

function isProofMirProgram(value: unknown): value is ProofMirProgram {
  return (
    value !== null &&
    typeof value === "object" &&
    "runtimeCatalog" in value &&
    "layoutTerms" in value &&
    "facts" in value
  );
}

function isProofMirBuildInput(value: unknown): value is ProofMirBuildInput {
  return (
    value !== null &&
    typeof value === "object" &&
    "program" in value &&
    "layout" in value &&
    "target" in value &&
    !("mir" in value)
  );
}

export function proofMirSummary(value: unknown): string {
  if (isProofMirProgram(value)) {
    return JSON.stringify(proofMirProgramSummary(value));
  }
  if (isProofMirBuildInput(value)) {
    return JSON.stringify(proofMirBuildInputSummary(value));
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    ("mir" in value || "input" in value || "diagnostics" in value)
  ) {
    const result = value as {
      readonly kind?: string;
      readonly mir?: ProofMirProgram;
      readonly input?: ProofMirBuildInput;
      readonly diagnostics?: readonly ProofMirDiagnostic[];
      readonly program?: unknown;
    };
    return JSON.stringify(
      stableSummaryValue({
        kind: result.kind,
        mir: result.mir !== undefined ? proofMirProgramSummary(result.mir) : undefined,
        input: result.input !== undefined ? proofMirBuildInputSummary(result.input) : undefined,
        diagnostics:
          result.diagnostics !== undefined
            ? sortDiagnosticsForSummary(result.diagnostics)
            : undefined,
        program: result.program,
      }),
    );
  }
  return JSON.stringify(stableSummaryValue(value));
}
