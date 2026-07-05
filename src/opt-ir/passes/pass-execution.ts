import type { OptIrDiagnostic, OptIrDiagnosticSink } from "../diagnostics";
import type { OptIrFreshIdAllocator } from "../id-allocation";
import { optimizationPassId, type OptimizationPassId } from "../ids";
import type { OptIrProgram } from "../program";
import {
  validateOptIrPassContract,
  type OptIrPassContract,
  type OptIrPassContractValidationIssue,
} from "./pass-contract";

export type OptIrPassName =
  | "cleanup"
  | "construction-cleanup"
  | "post-mandatory-cleanup"
  | "final-cleanup"
  | "mandatory-semantic-inlining"
  | "whole-program-inlining"
  | "whole-program-specialization"
  | "constant-folding"
  | "sccp-cleanup"
  | "sccp"
  | "dce"
  | "gvn"
  | "copy-propagation"
  | "cfg-simplification"
  | "memory-ssa"
  | "load-store-forwarding"
  | "dead-store-elimination"
  | "scalar-replacement"
  | "stack-promotion"
  | "licm"
  | "wrela-fact-rounds"
  | "fact-gated-egraph"
  | "vector-idiom-prep"
  | "slp-vectorization"
  | "certified-loop-vectorization"
  | "vector-cleanup"
  | "final-verification";

export interface OptIrPassContext {
  readonly passName: OptIrPassName;
  readonly freshIds: OptIrFreshIdAllocator;
  readonly verifierMode: "skip" | "after-run" | "strict";
  readonly diagnostics: OptIrDiagnosticSink;
}

export type OptIrPassRunResult<State> =
  | OptIrPassResult<State>
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface OptIrPassResult<State = OptIrProgram> {
  readonly kind: "ok";
  readonly state: State;
  readonly changed: boolean;
  readonly diagnostics: readonly OptIrDiagnostic[];
}

export interface OptIrPassDefinition<State = OptIrProgram> {
  readonly name: OptIrPassName;
  readonly passId: OptimizationPassId;
  readonly contract: OptIrPassContract;
  readonly run: (input: {
    readonly state: State;
    readonly context: OptIrPassContext;
  }) => OptIrPassRunResult<State>;
}

export type OptIrPassDefinitionValidationIssue =
  | OptIrPassContractValidationIssue
  | { readonly code: "PASS_NAME_CONTRACT_MISMATCH"; readonly path: string };

export type OptIrPassDefinitionValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly issues: readonly OptIrPassDefinitionValidationIssue[] };

export function unchangedOptIrPassResult(
  program: OptIrProgram,
  diagnostics: readonly OptIrDiagnostic[] = [],
): OptIrPassResult<OptIrProgram> {
  return unchangedOptIrPassStateResult(program, diagnostics);
}

export function changedOptIrPassResult(
  program: OptIrProgram,
  diagnostics: readonly OptIrDiagnostic[] = [],
): OptIrPassResult<OptIrProgram> {
  return changedOptIrPassStateResult(program, diagnostics);
}

export function unchangedOptIrPassStateResult<State>(
  state: State,
  diagnostics: readonly OptIrDiagnostic[] = [],
): OptIrPassResult<State> {
  return { kind: "ok", state, changed: false, diagnostics };
}

export function changedOptIrPassStateResult<State>(
  state: State,
  diagnostics: readonly OptIrDiagnostic[] = [],
): OptIrPassResult<State> {
  return { kind: "ok", state, changed: true, diagnostics };
}

export function errorOptIrPassResult(
  diagnostics: readonly OptIrDiagnostic[],
): OptIrPassRunResult<never> {
  return { kind: "error", diagnostics };
}

export function validateOptIrPassDefinition(
  definition: OptIrPassDefinition,
): OptIrPassDefinitionValidationResult {
  const issues: OptIrPassDefinitionValidationIssue[] = [];
  if (definition.passId !== optimizationPassId(definition.name)) {
    issues.push({ code: "PASS_NAME_CONTRACT_MISMATCH", path: "passId" });
  }
  if (definition.contract.passId !== definition.passId) {
    issues.push({ code: "PASS_NAME_CONTRACT_MISMATCH", path: "contract.passId" });
  }
  const contractResult = validateOptIrPassContract(definition.contract);
  if (contractResult.kind === "error") {
    issues.push(...contractResult.issues);
  }
  return issues.length === 0 ? { kind: "ok" } : { kind: "error", issues };
}

export function optIrPassNameToPassId(name: OptIrPassName): OptimizationPassId {
  return optimizationPassId(name);
}
