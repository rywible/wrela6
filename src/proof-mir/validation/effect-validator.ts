import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type {
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirLoanReference,
} from "../model/graph";
import type { ProofMirLoanId, ProofMirScopeId } from "../ids";
import { proofMirCrossedScopes, proofMirScopeStack } from "../domains/scope-tree";
import { type ProofMirValidatorProgram } from "./graph-validator";

export function validateProofMirEffects(program: ProofMirValidatorProgram): ProofMirDiagnostic[] {
  const diagnostics: ProofMirDiagnostic[] = [];

  for (const functionGraph of program.functions) {
    validateFunctionEffects(functionGraph, diagnostics);
  }

  return sortProofMirDiagnostics(diagnostics);
}

function validateFunctionEffects(
  functionGraph: ProofMirFunction,
  diagnostics: ProofMirDiagnostic[],
): void {
  const ownerKey = `function:${String(functionGraph.functionInstanceId)}`;

  validateScopeTree(functionGraph, ownerKey, diagnostics);

  for (const edge of functionGraph.edges.entries()) {
    validateEdgeCrossedScopes(functionGraph, edge, ownerKey, diagnostics);
  }

  for (const exit of functionGraph.exits) {
    validateExitCrossedScopes(functionGraph, exit, ownerKey, diagnostics);
  }

  validateLoans(functionGraph, ownerKey, diagnostics);
}

function validateScopeTree(
  functionGraph: ProofMirFunction,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  for (const scope of functionGraph.scopes.entries()) {
    if (scope.parentScopeId === undefined) {
      continue;
    }
    if (!functionGraph.scopes.has(scope.parentScopeId)) {
      recordScopeDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
        stableDetail: `missing-parent:${String(scope.scopeId)}:${String(scope.parentScopeId)}`,
        nodeDetail: String(scope.scopeId),
        message: "Proof MIR scope references a missing parent scope.",
      });
      continue;
    }

    const stack = proofMirScopeStack(scope.scopeId, functionGraph.scopes);
    if (stack === undefined) {
      recordScopeDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
        stableDetail: `scope-cycle:${String(scope.scopeId)}`,
        nodeDetail: String(scope.scopeId),
        message: "Proof MIR scope parent links form a cycle.",
      });
    }
  }
}

function validateEdgeCrossedScopes(
  functionGraph: ProofMirFunction,
  edge: ProofMirControlEdge,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (edge.toBlockId === undefined) {
    return;
  }

  const sourceBlock = functionGraph.blocks.get(edge.fromBlockId);
  if (sourceBlock === undefined) {
    return;
  }

  const sourceStack = proofMirScopeStack(sourceBlock.scopeId, functionGraph.scopes);
  if (sourceStack === undefined) {
    return;
  }

  const targetStack =
    edge.kind === "returnExit"
      ? functionScopeStack(functionGraph)
      : (() => {
          const targetBlock = functionGraph.blocks.get(edge.toBlockId);
          if (targetBlock === undefined) {
            return undefined;
          }
          return proofMirScopeStack(targetBlock.scopeId, functionGraph.scopes);
        })();
  if (targetStack === undefined) {
    return;
  }

  const expected = proofMirCrossedScopes(sourceStack, targetStack);
  if (!scopeListsEqual(expected, edge.crossedScopes)) {
    recordScopeDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
      stableDetail: `crossed-scopes:${String(edge.edgeId)}`,
      nodeDetail: String(edge.edgeId),
      message: "Proof MIR control edge crossed scopes do not match the scope stacks.",
    });
  }
}

function validateExitCrossedScopes(
  functionGraph: ProofMirFunction,
  exit: ProofMirExitEdge,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const sourceBlock = functionGraph.blocks.get(exit.fromBlockId);
  if (sourceBlock === undefined) {
    return;
  }

  const sourceStack = proofMirScopeStack(sourceBlock.scopeId, functionGraph.scopes);
  if (sourceStack === undefined) {
    return;
  }

  let targetStack: ProofMirScopeId[];
  switch (exit.boundary.kind) {
    case "function":
      targetStack = [];
      break;
    case "scope": {
      const stack = proofMirScopeStack(exit.boundary.targetScopeId, functionGraph.scopes);
      if (stack === undefined) {
        return;
      }
      targetStack = stack;
      break;
    }
    default: {
      const unreachable: never = exit.boundary;
      return unreachable;
    }
  }

  const expected = proofMirCrossedScopes(sourceStack, targetStack);
  if (!scopeListsEqual(expected, exit.crossedScopes)) {
    recordScopeDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
      stableDetail: `exit-crossed-scopes:${String(exit.exitId)}`,
      nodeDetail: String(exit.exitId),
      message: "Proof MIR exit edge crossed scopes do not match the scope stacks.",
    });
  }
}

function validateLoans(
  functionGraph: ProofMirFunction,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const loans = new Map<ProofMirLoanId, ProofMirLoanReference>();

  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      switch (statement.kind.kind) {
        case "borrowPlace": {
          const loan = statement.kind.loan;
          if (!isValidLoanReference(functionGraph, loan)) {
            recordLoanDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
              stableDetail: `invalid-loan:${String(loan.loanId)}`,
              nodeDetail: String(loan.loanId),
              message: "Proof MIR loan reference has invalid identity metadata.",
            });
            break;
          }
          const existing = loans.get(loan.loanId);
          if (existing !== undefined && !loanReferencesEqual(existing, loan)) {
            recordLoanDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
              stableDetail: `loan-identity:${String(loan.loanId)}`,
              nodeDetail: String(loan.loanId),
              message: "Proof MIR loan identity is not stable across references.",
            });
          }
          loans.set(loan.loanId, loan);
          break;
        }
        case "releaseLoan": {
          const loan = statement.kind.loan;
          const existing = loans.get(loan.loanId);
          if (existing === undefined) {
            if (!isValidLoanReference(functionGraph, loan)) {
              recordLoanDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
                stableDetail: `invalid-release:${String(loan.loanId)}`,
                nodeDetail: String(loan.loanId),
                message: "Proof MIR loan release references invalid identity metadata.",
              });
            }
            break;
          }
          if (!loanReferencesEqual(existing, loan)) {
            recordLoanDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
              stableDetail: `loan-release:${String(loan.loanId)}`,
              nodeDetail: String(loan.loanId),
              message: "Proof MIR loan release does not match the borrow identity.",
            });
          }
          if (loan.endOrigin === undefined) {
            recordLoanDiagnostic(functionGraph.functionInstanceId, ownerKey, diagnostics, {
              stableDetail: `loan-release-origin:${String(loan.loanId)}`,
              nodeDetail: String(loan.loanId),
              message: "Proof MIR loan release is missing end origin metadata.",
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

function isValidLoanReference(
  functionGraph: ProofMirFunction,
  loan: ProofMirLoanReference,
): boolean {
  if (!functionGraph.scopes.has(loan.scopeId)) {
    return false;
  }
  if (!functionGraph.places.has(loan.placeId)) {
    return false;
  }
  if (loan.mode !== "shared" && loan.mode !== "exclusive") {
    return false;
  }
  return loan.startOrigin !== undefined;
}

function loanReferencesEqual(left: ProofMirLoanReference, right: ProofMirLoanReference): boolean {
  return (
    left.loanId === right.loanId &&
    left.mode === right.mode &&
    left.placeId === right.placeId &&
    left.scopeId === right.scopeId &&
    left.startOrigin === right.startOrigin
  );
}

function scopeListsEqual(
  left: readonly ProofMirScopeId[],
  right: readonly ProofMirScopeId[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((scopeId, index) => scopeId === right[index]);
}

function functionScopeStack(functionGraph: ProofMirFunction): ProofMirScopeId[] | undefined {
  for (const scope of functionGraph.scopes.entries()) {
    if (scope.parentScopeId === undefined && scope.kind === "function") {
      return [scope.scopeId];
    }
  }
  return undefined;
}

function recordScopeDiagnostic(
  functionInstanceId: MonoInstanceId,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  input: {
    readonly message: string;
    readonly stableDetail: string;
    readonly nodeDetail: string;
  },
): void {
  diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_INVALID_SCOPE_TREE",
      message: input.message,
      ownerKey,
      rootCauseKey: "scope",
      stableDetail: input.stableDetail,
      functionInstanceId,
      nodeDetail: input.nodeDetail,
    }),
  );
}

function recordLoanDiagnostic(
  functionInstanceId: MonoInstanceId,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  input: {
    readonly message: string;
    readonly stableDetail: string;
    readonly nodeDetail: string;
  },
): void {
  diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_INVALID_LOAN_IDENTITY",
      message: input.message,
      ownerKey,
      rootCauseKey: "loan",
      stableDetail: input.stableDetail,
      functionInstanceId,
      nodeDetail: input.nodeDetail,
    }),
  );
}
