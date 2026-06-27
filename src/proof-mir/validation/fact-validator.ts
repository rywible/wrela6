import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  normalizeProofMirFactOperand,
  proofMirFactOperandAuthorityKey,
} from "../domains/fact-recording";
import type { ProofMirFactId } from "../ids";
import type {
  ProofMirFact,
  ProofMirFactKind,
  ProofMirFactOperand,
  ProofMirFactRole,
} from "../model/facts";
import type { ProofMirFunction } from "../model/graph";
import type { ProofMirProgram } from "../model/program";

const VALID_FACT_ROLES: ReadonlySet<ProofMirFactRole> = new Set([
  "evidence",
  "requirement",
  "trustedAxiom",
  "candidate",
]);

function factDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: "program",
    rootCauseKey: "fact",
    stableDetail: input.stableDetail,
  });
}

function trustedAxiomHasAuthority(fact: ProofMirFact, program: ProofMirProgram): boolean {
  switch (fact.kind.kind) {
    case "platformEnsured": {
      const kind = fact.kind;
      return fact.dependsOn.some(
        (dependency) =>
          dependency.kind === "platformEdge" &&
          proofMetadataIdKey(dependency.edgeId) === proofMetadataIdKey(kind.edgeId),
      );
    }
    case "runtimeEnsured": {
      const kind = fact.kind;
      if (program.runtimeCalls.get(kind.runtimeCallId) === undefined) {
        return false;
      }
      return fact.dependsOn.some(
        (dependency) =>
          dependency.kind === "runtimeCall" && dependency.runtimeCallId === kind.runtimeCallId,
      );
    }
    case "comparison":
    case "predicate":
    case "matchRefinement":
    case "layoutFits":
    case "payloadEnd":
    case "terminalCall":
      return false;
    default: {
      const unreachable: never = fact.kind;
      return unreachable;
    }
  }
}

function isNormalizedFactOperand(operand: ProofMirFactOperand): boolean {
  const normalized = normalizeProofMirFactOperand(operand);
  if (proofMirFactOperandAuthorityKey(operand) !== proofMirFactOperandAuthorityKey(normalized)) {
    return false;
  }
  if (operand.kind === "constant" && operand.literal.kind === "bool") {
    return false;
  }
  return true;
}

function collectFactOperands(kind: ProofMirFactKind): readonly ProofMirFactOperand[] {
  switch (kind.kind) {
    case "comparison":
      return [kind.left, kind.right];
    case "predicate":
      return kind.arguments;
    case "matchRefinement":
      return [kind.scrutinee];
    case "layoutFits":
    case "payloadEnd":
      return [];
    case "platformEnsured":
    case "runtimeEnsured":
    case "terminalCall":
      return [];
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function collectFactIdReferencesFromFunction(
  function_: ProofMirFunction,
): readonly ProofMirFactId[] {
  const references: ProofMirFactId[] = [];

  for (const block of function_.blocks.entries()) {
    for (const parameter of block.parameters) {
      if (
        parameter.parameterKind.kind === "proofFact" &&
        parameter.parameterKind.factId !== undefined
      ) {
        references.push(parameter.parameterKind.factId);
      }
    }

    for (const statement of block.statements) {
      switch (statement.kind.kind) {
        case "recordFactEvidence":
        case "requireFact":
          references.push(statement.kind.factId);
          break;
        case "dischargeObligation":
          if (statement.kind.evidence !== undefined) {
            references.push(statement.kind.evidence);
          }
          break;
        case "readValidatedBufferField":
          references.push(...statement.kind.read.readRequires);
          break;
        default:
          break;
      }
    }

    for (const edgeId of block.terminator.outgoingEdges) {
      const edge = function_.edges.get(edgeId);
      if (edge !== undefined) {
        references.push(...edge.facts);
      }
    }
  }

  for (const value of function_.values.entries()) {
    if (value.representation.kind === "fact") {
      references.push(value.representation.factId);
    }
  }

  return references;
}

export function validateProofMirFacts(program: ProofMirProgram): ProofMirDiagnostic[] {
  const diagnostics: ProofMirDiagnostic[] = [];

  for (const fact of program.facts.entries()) {
    if (!VALID_FACT_ROLES.has(fact.role)) {
      diagnostics.push(
        factDiagnostic({
          code: "PROOF_MIR_INVALID_FACT_ROLE",
          message: "Proof MIR fact role is not one of the closed builder roles.",
          stableDetail: `${String(fact.factId)}:${fact.role}`,
        }),
      );
    }

    if (fact.role === "trustedAxiom" && !trustedAxiomHasAuthority(fact, program)) {
      diagnostics.push(
        factDiagnostic({
          code: "PROOF_MIR_INVALID_FACT_AUTHORITY",
          message:
            "Trusted axiom facts require a matching platform-edge or runtime-call dependency.",
          stableDetail: `${fact.role}:${fact.kind.kind}:${String(fact.factId)}`,
        }),
      );
    }

    for (const operand of collectFactOperands(fact.kind)) {
      if (!isNormalizedFactOperand(operand)) {
        diagnostics.push(
          factDiagnostic({
            code: "PROOF_MIR_INVALID_FACT_OPERAND",
            message: "Proof MIR fact operand is not in normalized form.",
            stableDetail: `${String(fact.factId)}:${proofMirFactOperandAuthorityKey(operand)}`,
          }),
        );
      }
    }

    for (const dependency of fact.dependsOn) {
      if (dependency.kind === "fact" && !program.facts.has(dependency.factId)) {
        diagnostics.push(
          factDiagnostic({
            code: "PROOF_MIR_INVALID_FACT_TABLE_REFERENCE",
            message: "Proof MIR fact dependency references a missing fact ID.",
            stableDetail: `${String(fact.factId)}:depends-on:${String(dependency.factId)}`,
          }),
        );
      }

      if (
        dependency.kind === "privateState" &&
        !program.privateStateGenerations.has(dependency.generation.generationId)
      ) {
        diagnostics.push(
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_MISSING_PRIVATE_STATE_GENERATION",
            message: "Proof MIR fact dependency references a missing private-state generation.",
            ownerKey: "program",
            rootCauseKey: "private-state-generation",
            stableDetail: `${String(fact.factId)}:${String(dependency.generation.generationId)}`,
          }),
        );
      }
    }
  }

  for (const runtimeCall of program.runtimeCalls.entries()) {
    for (const factId of runtimeCall.requiredFacts) {
      if (!program.facts.has(factId)) {
        diagnostics.push(
          factDiagnostic({
            code: "PROOF_MIR_INVALID_FACT_TABLE_REFERENCE",
            message: "Runtime call contract references a missing fact ID.",
            stableDetail: `runtime-call:${String(runtimeCall.runtimeCallId)}:fact:${String(factId)}`,
          }),
        );
      }
    }
  }

  for (const function_ of program.functions.entries()) {
    for (const factId of collectFactIdReferencesFromFunction(function_)) {
      if (!program.facts.has(factId)) {
        diagnostics.push(
          factDiagnostic({
            code: "PROOF_MIR_INVALID_FACT_TABLE_REFERENCE",
            message: "Proof MIR function references a missing fact ID.",
            stableDetail: `${String(function_.functionInstanceId)}:fact:${String(factId)}`,
          }),
        );
      }
    }
  }

  return sortProofMirDiagnostics(diagnostics);
}
