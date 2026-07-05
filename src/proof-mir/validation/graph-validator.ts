import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  validateControlEdgeOutgoingReference,
  validateControlEdgeTarget,
  validateStoredIncomingEdges,
} from "./incoming-edge-validator";
import type {
  ProofMirBlock,
  ProofMirBlockParameter,
  ProofMirBlockTarget,
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirTerminatorKind,
  ProofMirValue,
} from "../model/graph";
import type { ProofMirOperand } from "../model/operands";
import type { ProofMirValueId } from "../ids";
import { collectStatementReferences } from "./reference-collector";
import { countCriticalEdges, validateReducibility } from "./cfg-summary-validator";

export interface ProofMirValidatorProgram {
  readonly functions: readonly ProofMirFunction[];
}

export interface ProofMirGraphValidationSummary {
  readonly criticalEdgeCount: number;
}

export interface ProofMirGraphValidationResult {
  readonly diagnostics: readonly ProofMirDiagnostic[];
  readonly summary: ProofMirGraphValidationSummary;
}

export function validateProofMirGraph(program: ProofMirValidatorProgram): ProofMirDiagnostic[] {
  return [...validateProofMirGraphWithSummary(program).diagnostics];
}

export function validateProofMirGraphWithSummary(
  program: ProofMirValidatorProgram,
): ProofMirGraphValidationResult {
  const diagnostics: ProofMirDiagnostic[] = [];
  let criticalEdgeCount = 0;

  for (const functionGraph of program.functions) {
    validateFunctionGraph(functionGraph, diagnostics);
    criticalEdgeCount += countCriticalEdges(functionGraph);
  }

  return Object.freeze({
    diagnostics: sortProofMirDiagnostics(diagnostics),
    summary: Object.freeze({ criticalEdgeCount }),
  });
}

function validateFunctionGraph(
  functionGraph: ProofMirFunction,
  diagnostics: ProofMirDiagnostic[],
): void {
  const ownerKey = `function:${String(functionGraph.functionInstanceId)}`;

  if (!functionGraph.blocks.has(functionGraph.entryBlockId)) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_CFG",
      message: "Proof MIR function entry block is missing.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `missing-entry:${String(functionGraph.entryBlockId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
    });
  }

  for (const block of functionGraph.blocks.entries()) {
    validateBlockScope(functionGraph, block, ownerKey, diagnostics);
    validateTerminatorEdges(functionGraph, block, ownerKey, diagnostics);
    validateBlockParameters(functionGraph, block, ownerKey, diagnostics);
  }

  for (const edge of functionGraph.edges.entries()) {
    validateControlEdgeOutgoingReference(functionGraph, edge, ownerKey, diagnostics);
    validateControlEdgeTarget(functionGraph, edge, ownerKey, diagnostics);
    validateJoinArguments(functionGraph, edge, ownerKey, diagnostics);
  }

  validateStoredIncomingEdges(functionGraph, ownerKey, diagnostics);
  validateScalarSsa(functionGraph, ownerKey, diagnostics);
  validateStatementReferences(functionGraph, ownerKey, diagnostics);
  validateReducibility({ functionGraph, ownerKey, diagnostics });
  validateReturnAndPanicExits(functionGraph, ownerKey, diagnostics);
}

function validateBlockScope(
  functionGraph: ProofMirFunction,
  block: ProofMirBlock,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (!functionGraph.scopes.has(block.scopeId)) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_SCOPE_TREE",
      message: "Proof MIR block references a missing scope.",
      ownerKey,
      rootCauseKey: "scope",
      stableDetail: `missing-block-scope:${String(block.blockId)}:${String(block.scopeId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.blockId),
    });
  }
}

function validateTerminatorEdges(
  functionGraph: ProofMirFunction,
  block: ProofMirBlock,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const referencedEdges = collectTerminatorEdgeIds(block.terminator.kind);
  const outgoing = [...block.terminator.outgoingEdges].sort((left, right) => left - right);
  const referenced = [...referencedEdges].sort((left, right) => left - right);

  if (
    outgoing.length !== referenced.length ||
    outgoing.some((edgeId, index) => edgeId !== referenced[index])
  ) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_CFG",
      message: "Proof MIR terminator outgoing edges do not match referenced control edges.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `terminator-edges:${String(block.blockId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.terminator.terminatorId),
    });
  }

  for (const target of collectTerminatorTargets(block.terminator.kind)) {
    validateBlockTarget(functionGraph, block, target, ownerKey, diagnostics);
  }
}

function validateBlockTarget(
  functionGraph: ProofMirFunction,
  block: ProofMirBlock,
  target: ProofMirBlockTarget,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const edge = functionGraph.edges.get(target.edgeId);
  if (edge === undefined) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_MISSING_CONTROL_EDGE",
      message: "Proof MIR block target references a missing control edge.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `missing-edge:${String(target.edgeId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.terminator.terminatorId),
    });
    return;
  }

  if (edge.toBlockId !== target.blockId) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_MISSING_CONTROL_EDGE",
      message: "Proof MIR block target edge resolves to a different destination block.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `edge-target:${String(target.edgeId)}:${String(edge.toBlockId)}:${String(target.blockId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.terminator.terminatorId),
    });
  }

  if (edge.fromBlockId !== block.blockId) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INCOMING_EDGES_MISMATCH",
      message: "Proof MIR block target edge is owned by a different source block.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `edge-source:${String(target.edgeId)}:${String(edge.fromBlockId)}:${String(
        block.blockId,
      )}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.blockId),
    });
  }

  if (!functionGraph.blocks.has(target.blockId)) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_CFG",
      message: "Proof MIR block target references a missing block.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `missing-target-block:${String(target.blockId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.terminator.terminatorId),
    });
  }
}

function edgeUsesJoinBlockParameters(edge: ProofMirControlEdge): boolean {
  switch (edge.kind) {
    case "normal":
    case "branchTrue":
    case "branchFalse":
    case "switchCase":
      return true;
    case "validationOk":
    case "validationErr":
    case "attemptSuccess":
    case "attemptError":
    case "scopeBreak":
    case "scopeContinue":
    case "yieldSuspend":
    case "yieldResume":
    case "returnExit":
    case "panicExit":
      return false;
    default: {
      const unreachable: never = edge.kind;
      return unreachable;
    }
  }
}

function validateJoinArguments(
  functionGraph: ProofMirFunction,
  edge: ProofMirControlEdge,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (!edgeUsesJoinBlockParameters(edge)) {
    return;
  }
  if (edge.toBlockId === undefined) {
    return;
  }

  const targetBlock = functionGraph.blocks.get(edge.toBlockId);
  if (targetBlock === undefined) {
    return;
  }

  if (edge.arguments.length !== targetBlock.parameters.length) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_JOIN_ARGUMENTS",
      message: "Proof MIR control edge argument count does not match target block parameters.",
      ownerKey,
      rootCauseKey: "join",
      stableDetail: `join-count:${String(edge.edgeId)}:${edge.arguments.length}:${targetBlock.parameters.length}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(edge.edgeId),
    });
    return;
  }

  for (let index = 0; index < edge.arguments.length; index += 1) {
    const argumentValueId = edge.arguments[index]!;
    const parameter = targetBlock.parameters[index]!;
    const argumentValue = functionGraph.values.get(argumentValueId);
    if (argumentValue === undefined) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_JOIN_ARGUMENTS",
        message: "Proof MIR control edge argument references a missing value.",
        ownerKey,
        rootCauseKey: "join",
        stableDetail: `join-missing-argument:${String(edge.edgeId)}:${index}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(edge.edgeId),
      });
      return;
    }
    if (!isValidJoinArgumentValue(parameter, argumentValue)) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_JOIN_ARGUMENTS",
        message: "Proof MIR control edge argument is incompatible with the target block parameter.",
        ownerKey,
        rootCauseKey: "join",
        stableDetail: `join-incompatible:${String(edge.edgeId)}:${index}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(edge.edgeId),
      });
      return;
    }
  }
}

function isValidJoinArgumentValue(
  parameter: ProofMirBlockParameter,
  argumentValue: ProofMirValue,
): boolean {
  switch (parameter.parameterKind.kind) {
    case "copyScalar":
      return (
        argumentValue.representation.kind === "runtime" &&
        argumentValue.resourceKind === parameter.parameterKind.resourceKind
      );
    case "proofFact":
      return (
        argumentValue.representation.kind === "fact" ||
        argumentValue.representation.kind === "proofOnly"
      );
    default: {
      const unreachable: never = parameter.parameterKind;
      return unreachable;
    }
  }
}

function validateBlockParameters(
  functionGraph: ProofMirFunction,
  block: ProofMirBlock,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  for (const parameter of block.parameters) {
    validateBlockParameter(functionGraph, block, parameter, ownerKey, diagnostics);
  }
}

function validateBlockParameter(
  functionGraph: ProofMirFunction,
  block: ProofMirBlock,
  parameter: ProofMirBlockParameter,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  switch (parameter.parameterKind.kind) {
    case "copyScalar":
      break;
    case "proofFact":
      break;
    default: {
      const unreachable: never = parameter.parameterKind;
      return unreachable;
    }
  }

  const value = functionGraph.values.get(parameter.valueId);
  if (value === undefined) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_SSA",
      message: "Proof MIR block parameter references a missing value.",
      ownerKey,
      rootCauseKey: "ssa",
      stableDetail: `missing-parameter-value:${String(block.blockId)}:${String(parameter.valueId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.blockId),
    });
    return;
  }

  if (!isValidBlockParameterValue(parameter, value)) {
    const code =
      value.representation.kind === "runtime" &&
      parameter.parameterKind.kind === "copyScalar" &&
      value.resourceKind !== parameter.parameterKind.resourceKind
        ? "PROOF_MIR_TYPE_RESOURCE_KIND_MISMATCH"
        : "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND";
    recordDiagnostic(diagnostics, {
      code,
      message:
        code === "PROOF_MIR_TYPE_RESOURCE_KIND_MISMATCH"
          ? "Proof MIR block parameter value resource kind does not match the parameter type."
          : "Proof MIR block parameter value does not carry a copy scalar or proof-fact representation.",
      ownerKey,
      rootCauseKey: "value",
      stableDetail: `parameter-value:${String(block.blockId)}:${String(parameter.valueId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.blockId),
    });
  }
}

function isValidBlockParameterValue(
  parameter: ProofMirBlockParameter,
  value: ProofMirValue,
): boolean {
  switch (parameter.parameterKind.kind) {
    case "copyScalar":
      return (
        value.representation.kind === "runtime" &&
        value.resourceKind === parameter.parameterKind.resourceKind
      );
    case "proofFact":
      return value.representation.kind === "fact" || value.representation.kind === "proofOnly";
    default: {
      const unreachable: never = parameter.parameterKind;
      return unreachable;
    }
  }
}

function validateScalarSsa(
  functionGraph: ProofMirFunction,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const uses = new Map<ProofMirValueId, string[]>();
  const definitionCount = new Map<ProofMirValueId, number>();
  for (const block of functionGraph.blocks.entries()) {
    for (const parameter of block.parameters) {
      definitionCount.set(parameter.valueId, (definitionCount.get(parameter.valueId) ?? 0) + 1);
    }
    for (const statement of block.statements) {
      for (const defined of collectStatementReferences(statement).writes) {
        definitionCount.set(defined, (definitionCount.get(defined) ?? 0) + 1);
      }
    }
    for (const statement of block.statements) {
      for (const read of collectStatementReferences(statement).reads) {
        noteUse(uses, read, `statement:${String(statement.statementId)}`);
      }
    }
    collectTerminatorUses(
      block.terminator.kind,
      `terminator:${String(block.terminator.terminatorId)}`,
      uses,
    );
  }

  for (const edge of functionGraph.edges.entries()) {
    if (edgeUsesJoinBlockParameters(edge)) {
      for (const argument of edge.arguments) {
        noteUse(uses, argument, `edge:${String(edge.edgeId)}`);
      }
      continue;
    }
    for (const argument of edge.arguments) {
      definitionCount.set(argument, (definitionCount.get(argument) ?? 0) + 1);
    }
  }

  for (const [valueId, count] of definitionCount.entries()) {
    if (count > 1) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_SSA",
        message: "Proof MIR scalar value has multiple definitions.",
        ownerKey,
        rootCauseKey: "ssa",
        stableDetail: `duplicate-definition:${String(valueId)}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(valueId),
      });
    }
  }

  for (const [valueId, useSites] of uses.entries()) {
    if (!definitionCount.has(valueId)) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_SSA",
        message: "Proof MIR value use does not resolve to a definition.",
        ownerKey,
        rootCauseKey: "ssa",
        stableDetail: `missing-definition:${String(valueId)}:${useSites.join(",")}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(valueId),
      });
    }
  }
}

function validateStatementReferences(
  functionGraph: ProofMirFunction,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      const references = collectStatementReferences(statement);
      const site = `statement:${String(statement.statementId)}`;
      for (const place of references.places) {
        if (!functionGraph.places.has(place)) {
          recordDiagnostic(diagnostics, {
            code: "PROOF_MIR_DANGLING_REFERENCE",
            message: "Proof MIR statement references a missing place.",
            ownerKey,
            rootCauseKey: "reference",
            stableDetail: `category:place:${site}:${String(place)}`,
            functionInstanceId: functionGraph.functionInstanceId,
            nodeDetail: String(statement.statementId),
          });
        }
      }
      for (const loan of references.loans) {
        if (!functionGraph.places.has(loan.placeId) || !functionGraph.scopes.has(loan.scopeId)) {
          recordDiagnostic(diagnostics, {
            code: "PROOF_MIR_DANGLING_REFERENCE",
            message: "Proof MIR statement references a missing loan anchor.",
            ownerKey,
            rootCauseKey: "reference",
            stableDetail: `category:loan:${site}:${String(loan.loanId)}`,
            functionInstanceId: functionGraph.functionInstanceId,
            nodeDetail: String(statement.statementId),
          });
        }
      }
      for (const session of references.sessions) {
        if (session.placeId !== undefined && !functionGraph.places.has(session.placeId)) {
          recordDiagnostic(diagnostics, {
            code: "PROOF_MIR_DANGLING_REFERENCE",
            message: "Proof MIR statement references a missing session place.",
            ownerKey,
            rootCauseKey: "reference",
            stableDetail: `category:session:${site}:${String(session.sessionId.instanceId)}`,
            functionInstanceId: functionGraph.functionInstanceId,
            nodeDetail: String(statement.statementId),
          });
        }
      }
      for (const term of references.layoutTerms) {
        if (term.termId === undefined) {
          recordDiagnostic(diagnostics, {
            code: "PROOF_MIR_DANGLING_REFERENCE",
            message: "Proof MIR statement references a missing layout term.",
            ownerKey,
            rootCauseKey: "reference",
            stableDetail: `category:layoutTerm:${site}:missing`,
            functionInstanceId: functionGraph.functionInstanceId,
            nodeDetail: String(statement.statementId),
          });
        }
      }
    }
  }
}

function validateReturnAndPanicExits(
  functionGraph: ProofMirFunction,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  for (const block of functionGraph.blocks.entries()) {
    const kind = block.terminator.kind;
    if (kind.kind !== "return" && kind.kind !== "panic") {
      continue;
    }

    const controlEdge = functionGraph.edges.get(kind.edgeId);
    if (controlEdge === undefined) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY",
        message: "Proof MIR return or panic terminator is missing its control edge.",
        ownerKey,
        rootCauseKey: "exit",
        stableDetail: `missing-return-edge:${String(kind.edgeId)}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(block.terminator.terminatorId),
      });
      continue;
    }

    const exitEdge = findExitEdge(functionGraph, kind.exit, block.blockId);
    if (exitEdge === undefined) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY",
        message: "Proof MIR return or panic terminator is missing its exit edge.",
        ownerKey,
        rootCauseKey: "exit",
        stableDetail: `missing-return-exit:${String(kind.exit)}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(block.terminator.terminatorId),
      });
      continue;
    }

    if (controlEdge.exit === undefined) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY",
        message: "Proof MIR return or panic control edge is missing its matching exit edge link.",
        ownerKey,
        rootCauseKey: "exit",
        stableDetail: `missing-exit-link:${String(kind.edgeId)}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(block.terminator.terminatorId),
      });
      continue;
    }

    if (controlEdge.exit !== exitEdge.exitId) {
      recordDiagnostic(diagnostics, {
        code: "PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY",
        message:
          "Proof MIR return or panic control edge does not reference the matching exit edge.",
        ownerKey,
        rootCauseKey: "exit",
        stableDetail: `exit-link:${String(kind.edgeId)}:${String(kind.exit)}`,
        functionInstanceId: functionGraph.functionInstanceId,
        nodeDetail: String(block.terminator.terminatorId),
      });
    }
  }
}

function findExitEdge(
  functionGraph: ProofMirFunction,
  exitId: ProofMirExitEdge["exitId"],
  fromBlockId: ProofMirBlock["blockId"],
): ProofMirExitEdge | undefined {
  return functionGraph.exits.find(
    (exit) => exit.exitId === exitId && exit.fromBlockId === fromBlockId,
  );
}

function collectTerminatorEdgeIds(kind: ProofMirTerminatorKind): ProofMirControlEdge["edgeId"][] {
  switch (kind.kind) {
    case "goto":
      return [kind.target.edgeId];
    case "branch":
      return [kind.whenTrue.edgeId, kind.whenFalse.edgeId];
    case "switch":
      return [
        ...kind.cases.map((caseEntry) => caseEntry.target.edgeId),
        ...(kind.fallback === undefined ? [] : [kind.fallback.edgeId]),
      ];
    case "matchValidation":
      return [kind.match.okTarget.edgeId, kind.match.errTarget.edgeId];
    case "matchAttempt":
      return [kind.match.successTarget.edgeId, kind.match.errorTarget.edgeId];
    case "return":
      return [kind.edgeId];
    case "panic":
      return [kind.edgeId];
    case "unreachable":
      return [];
    case "yield":
      return [kind.suspension.suspendEdge, kind.suspension.resumeTarget.edgeId];
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function collectTerminatorTargets(kind: ProofMirTerminatorKind): ProofMirBlockTarget[] {
  switch (kind.kind) {
    case "goto":
      return [kind.target];
    case "branch":
      return [kind.whenTrue, kind.whenFalse];
    case "switch":
      return [
        ...kind.cases.map((caseEntry) => caseEntry.target),
        ...(kind.fallback === undefined ? [] : [kind.fallback]),
      ];
    case "matchValidation":
      return [kind.match.okTarget, kind.match.errTarget];
    case "matchAttempt":
      return [kind.match.successTarget, kind.match.errorTarget];
    case "return":
    case "panic":
    case "unreachable":
      return [];
    case "yield":
      return [kind.suspension.resumeTarget];
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function collectTerminatorUses(
  kind: ProofMirTerminatorKind,
  site: string,
  uses: Map<ProofMirValueId, string[]>,
): void {
  switch (kind.kind) {
    case "branch":
      noteUse(uses, kind.condition, site);
      break;
    case "switch":
      noteUse(uses, kind.scrutinee, site);
      break;
    case "return":
      if (kind.value !== undefined) {
        noteOperandUses(kind.value.operand, site, uses);
      }
      break;
    case "panic":
      if (kind.reason !== undefined) {
        noteUse(uses, kind.reason, site);
      }
      break;
    case "goto":
    case "matchValidation":
    case "matchAttempt":
    case "unreachable":
    case "yield":
      break;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function noteUse(
  uses: Map<ProofMirValueId, string[]>,
  valueId: ProofMirValueId,
  site: string,
): void {
  const existing = uses.get(valueId) ?? [];
  existing.push(site);
  uses.set(valueId, existing);
}

function noteOperandUses(
  operand: ProofMirOperand | undefined,
  site: string,
  uses: Map<ProofMirValueId, string[]>,
): void {
  if (operand === undefined) {
    return;
  }
  switch (operand.kind) {
    case "value":
      noteUse(uses, operand.value, site);
      break;
    case "valueAndPlace":
      noteUse(uses, operand.value, site);
      break;
    case "place":
      break;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function recordDiagnostic(
  diagnostics: ProofMirDiagnostic[],
  input: {
    readonly code: string;
    readonly message: string;
    readonly ownerKey: string;
    readonly rootCauseKey: string;
    readonly stableDetail: string;
    readonly functionInstanceId: MonoInstanceId;
    readonly nodeDetail?: string;
  },
): void {
  diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: input.code,
      message: input.message,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
      functionInstanceId: input.functionInstanceId,
      ...(input.nodeDetail === undefined ? {} : { nodeDetail: input.nodeDetail }),
    }),
  );
}

export { proofMirCrossedScopes, proofMirScopeStack } from "../domains/scope-tree";
export { deriveProofMirPredecessorSets } from "./incoming-edge-validator";
