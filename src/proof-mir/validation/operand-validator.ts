import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type { ProofMirCall } from "../model/graph";
import type {
  ProofMirAttemptAlternative,
  ProofMirAttemptOperand,
  ProofMirCallArgument,
  ProofMirCallReceiver,
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
  ProofMirProducedOperand,
  ProofMirReturnOperand,
  ProofMirValidationArmBinding,
} from "../model/operands";
import type { ProofMirFunction, ProofMirStatement, ProofMirTerminatorKind } from "../model/graph";
import type { ProofMirValidatorProgram } from "./graph-validator";

export function validateProofMirOperands(program: ProofMirValidatorProgram): ProofMirDiagnostic[] {
  const diagnostics: ProofMirDiagnostic[] = [];

  for (const functionGraph of program.functions) {
    validateFunctionOperands(functionGraph, diagnostics);
  }

  return sortProofMirDiagnostics(diagnostics);
}

function validateFunctionOperands(
  functionGraph: ProofMirFunction,
  diagnostics: ProofMirDiagnostic[],
): void {
  const ownerKey = `function:${String(functionGraph.functionInstanceId)}`;

  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      validateStatementOperands(functionGraph, statement, ownerKey, diagnostics);
    }
    validateTerminatorOperands(functionGraph, block.terminator.kind, ownerKey, diagnostics);
  }
}

function validateStatementOperands(
  functionGraph: ProofMirFunction,
  statement: ProofMirStatement,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  switch (statement.kind.kind) {
    case "call":
      validateCallOperands(functionGraph, statement.kind.call, ownerKey, diagnostics);
      break;
    case "attempt":
      validateAttemptOperand(functionGraph, statement.kind.attempt.fallible, ownerKey, diagnostics);
      if (statement.kind.attempt.alternative !== undefined) {
        validateAttemptAlternative(
          functionGraph,
          statement.kind.attempt.alternative,
          ownerKey,
          diagnostics,
        );
      }
      break;
    case "take":
      validateObservedOrConsumedOperand(
        functionGraph,
        statement.kind.take.operand,
        "consume",
        ownerKey,
        diagnostics,
        `take:${String(statement.statementId)}`,
      );
      break;
    default:
      break;
  }
}

function validateTerminatorOperands(
  functionGraph: ProofMirFunction,
  kind: ProofMirTerminatorKind,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  switch (kind.kind) {
    case "return":
      if (kind.value !== undefined) {
        validateReturnOperand(functionGraph, kind.value, ownerKey, diagnostics, "return");
      }
      break;
    case "matchValidation":
      for (const binding of kind.match.okBindings) {
        validateValidationArmBinding(
          functionGraph,
          binding,
          ownerKey,
          diagnostics,
          "validation-ok",
        );
      }
      for (const binding of kind.match.errBindings) {
        validateValidationArmBinding(
          functionGraph,
          binding,
          ownerKey,
          diagnostics,
          "validation-err",
        );
      }
      break;
    case "yield":
      if (kind.suspension.payload !== undefined) {
        validateReturnOperand(
          functionGraph,
          kind.suspension.payload,
          ownerKey,
          diagnostics,
          "yield",
        );
      }
      break;
    default:
      break;
  }
}

function validateCallOperands(
  functionGraph: ProofMirFunction,
  call: ProofMirCall,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (call.receiver !== undefined) {
    validateCallReceiver(functionGraph, call.receiver, ownerKey, diagnostics, String(call.callId));
  }
  for (const argument of call.arguments) {
    validateCallArgument(functionGraph, argument, ownerKey, diagnostics, String(call.callId));
  }
  if (call.result !== undefined) {
    validateProducedOperand(functionGraph, call.result, ownerKey, diagnostics, String(call.callId));
  }
}

function validateCallReceiver(
  functionGraph: ProofMirFunction,
  receiver: ProofMirCallReceiver,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  callDetail: string,
): void {
  if (receiver.mode === "consume") {
    validateConsumedOperand(
      functionGraph,
      receiver.operand,
      ownerKey,
      diagnostics,
      `receiver:${callDetail}`,
    );
    return;
  }
  validateObservedOperand(
    functionGraph,
    receiver.operand,
    ownerKey,
    diagnostics,
    `receiver:${callDetail}`,
  );
}

function validateCallArgument(
  functionGraph: ProofMirFunction,
  argument: ProofMirCallArgument,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  callDetail: string,
): void {
  if (argument.mode === "consume") {
    validateConsumedOperand(
      functionGraph,
      argument.operand,
      ownerKey,
      diagnostics,
      `argument:${callDetail}`,
    );
    return;
  }
  validateObservedOperand(
    functionGraph,
    argument.operand,
    ownerKey,
    diagnostics,
    `argument:${callDetail}`,
  );
}

function validateReturnOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirReturnOperand,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
): void {
  if (operand.mode === "consume") {
    validateConsumedOperand(functionGraph, operand.operand, ownerKey, diagnostics, site);
    return;
  }
  validateObservedOperand(functionGraph, operand.operand, ownerKey, diagnostics, site);
}

function validateAttemptOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirAttemptOperand,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (operand.result !== undefined) {
    validateProducedOperand(functionGraph, operand.result, ownerKey, diagnostics, "attempt");
  }
}

function validateAttemptAlternative(
  functionGraph: ProofMirFunction,
  alternative: ProofMirAttemptAlternative,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (alternative.result !== undefined) {
    validateProducedOperand(
      functionGraph,
      alternative.result,
      ownerKey,
      diagnostics,
      "attempt-alt",
    );
  }
}

function validateValidationArmBinding(
  functionGraph: ProofMirFunction,
  binding: ProofMirValidationArmBinding,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
): void {
  validateProducedOperand(functionGraph, binding.operand, ownerKey, diagnostics, site);
}

function validateObservedOrConsumedOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirObservedOperand | ProofMirConsumedOperand,
  mode: "observe" | "consume",
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
): void {
  if (mode === "consume") {
    validateConsumedOperand(
      functionGraph,
      operand as ProofMirConsumedOperand,
      ownerKey,
      diagnostics,
      site,
    );
    return;
  }
  validateObservedOperand(
    functionGraph,
    operand as ProofMirObservedOperand,
    ownerKey,
    diagnostics,
    site,
  );
}

function validateConsumedOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirConsumedOperand | ProofMirObservedOperand,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
): void {
  switch (operand.kind) {
    case "value":
      recordInvalidCallOperand(
        functionGraph.functionInstanceId,
        ownerKey,
        diagnostics,
        site,
        "Proof MIR consume operand cannot be value-only.",
      );
      break;
    case "place":
      if (functionGraph.places.get(operand.place) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "place",
        );
      }
      break;
    case "valueAndPlace":
      if (functionGraph.values.get(operand.value) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "value",
        );
      }
      if (functionGraph.places.get(operand.place) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "place",
        );
      }
      break;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function validateObservedOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirObservedOperand,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
): void {
  switch (operand.kind) {
    case "value":
      if (functionGraph.values.get(operand.value) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "value",
        );
      }
      break;
    case "place":
      if (functionGraph.places.get(operand.place) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "place",
        );
      }
      break;
    case "valueAndPlace":
      if (functionGraph.values.get(operand.value) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "value",
        );
      }
      if (functionGraph.places.get(operand.place) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "place",
        );
      }
      break;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function validateProducedOperand(
  functionGraph: ProofMirFunction,
  operand: ProofMirProducedOperand,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
): void {
  switch (operand.kind) {
    case "value":
      if (functionGraph.values.get(operand.value) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "value",
        );
      }
      break;
    case "place":
      if (functionGraph.places.get(operand.place) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "place",
        );
      }
      break;
    case "valueAndPlace":
      if (functionGraph.values.get(operand.value) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "value",
        );
      }
      if (functionGraph.places.get(operand.place) === undefined) {
        recordInvalidOperandReference(
          functionGraph.functionInstanceId,
          ownerKey,
          diagnostics,
          site,
          "place",
        );
      }
      break;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function recordInvalidOperandReference(
  functionInstanceId: MonoInstanceId,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
  referenceKind: "value" | "place",
): void {
  diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_INVALID_CALL_OPERAND",
      message: `Proof MIR operand references an unknown ${referenceKind}.`,
      ownerKey,
      rootCauseKey: "operand",
      stableDetail: `${site}:${referenceKind}`,
      functionInstanceId,
    }),
  );
}

function recordInvalidCallOperand(
  functionInstanceId: MonoInstanceId,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
  site: string,
  message: string,
): void {
  diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_INVALID_CALL_OPERAND",
      message,
      ownerKey,
      rootCauseKey: "operand",
      stableDetail: site,
      functionInstanceId,
    }),
  );
}
