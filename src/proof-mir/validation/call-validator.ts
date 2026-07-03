import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type { ProofMirCallId, ProofMirOwnedCallId } from "../ids";
import { proofMirOwnedCallIdKey } from "../ids";
import type {
  ProofMirCallGraphEdge,
  ProofMirCallTarget,
  ProofMirRuntimeCallContract,
} from "../model/calls";
import type { ProofMirFunction } from "../model/graph";
import type { ProofMirProgram } from "../model/program";

function callDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: "call",
    stableDetail: input.stableDetail,
    ...(input.functionInstanceId === undefined
      ? {}
      : { functionInstanceId: input.functionInstanceId }),
  });
}

function callTargetsEqual(left: ProofMirCallTarget, right: ProofMirCallTarget): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "sourceFunction":
      return (
        right.kind === "sourceFunction" &&
        String(left.functionInstanceId) === String(right.functionInstanceId)
      );
    case "certifiedPlatform":
      return (
        right.kind === "certifiedPlatform" &&
        proofMetadataIdKey(left.edgeId) === proofMetadataIdKey(right.edgeId) &&
        String(left.primitiveId) === String(right.primitiveId)
      );
    case "compilerIntrinsic":
      return (
        right.kind === "compilerIntrinsic" &&
        left.intrinsicKey === right.intrinsicKey &&
        left.sourceValueKey === right.sourceValueKey &&
        left.returnTypeKey === right.returnTypeKey
      );
    case "compilerRuntime":
      return (
        right.kind === "compilerRuntime" &&
        left.runtimeId === right.runtimeId &&
        left.runtimeCallId === right.runtimeCallId
      );
    default: {
      const unreachable: never = left;
      return unreachable;
    }
  }
}

function runtimeCatalogContainsFunctionLocalIds(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(runtimeCatalogContainsFunctionLocalIds);
  }
  const record = value as Record<string, unknown>;
  if (
    "functionInstanceId" in record &&
    ("valueId" in record || "placeId" in record || "callId" in record || "factId" in record)
  ) {
    return true;
  }
  return Object.values(record).some(runtimeCatalogContainsFunctionLocalIds);
}

function validateRuntimeCallContract(input: {
  readonly program: ProofMirProgram;
  readonly contract: ProofMirRuntimeCallContract;
  readonly functionInstanceId: MonoInstanceId;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const operation = input.program.runtimeCatalog.get(input.contract.runtimeId);
  if (operation === undefined) {
    input.diagnostics.push(
      callDiagnostic({
        code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
        message: "Runtime call contract references a missing runtime catalog operation.",
        ownerKey: "program",
        stableDetail: `runtime-call:${String(input.contract.runtimeCallId)}:operation:${String(input.contract.runtimeId)}`,
        functionInstanceId: input.functionInstanceId,
      }),
    );
    return;
  }

  if (input.contract.callId.functionInstanceId !== input.functionInstanceId) {
    input.diagnostics.push(
      callDiagnostic({
        code: "PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT",
        message: "Runtime call contract call ID owner does not match the enclosing function.",
        ownerKey: proofMirOwnedCallIdKey(input.contract.callId),
        stableDetail: `runtime-call:${String(input.contract.runtimeCallId)}:owner-mismatch`,
        functionInstanceId: input.functionInstanceId,
      }),
    );
  }

  for (const place of [
    ...input.contract.consumedCapabilities,
    ...input.contract.producedCapabilities,
  ]) {
    if (place.functionInstanceId !== input.functionInstanceId) {
      input.diagnostics.push(
        callDiagnostic({
          code: "PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT",
          message: "Runtime call contract place is not owned by the enclosing function.",
          ownerKey: proofMirOwnedCallIdKey(input.contract.callId),
          stableDetail: `runtime-call:${String(input.contract.runtimeCallId)}:place-owner`,
          functionInstanceId: input.functionInstanceId,
        }),
      );
    }
  }

  for (const effect of input.contract.effects) {
    switch (effect.kind) {
      case "readsMemory":
      case "writesMemory":
      case "advancesPrivateState":
        if (effect.place.functionInstanceId !== input.functionInstanceId) {
          input.diagnostics.push(
            callDiagnostic({
              code: "PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT",
              message: "Runtime call contract effect place is not owned by the enclosing function.",
              ownerKey: proofMirOwnedCallIdKey(input.contract.callId),
              stableDetail: `runtime-call:${String(input.contract.runtimeCallId)}:effect-place`,
              functionInstanceId: input.functionInstanceId,
            }),
          );
        }
        break;
      case "pure":
      case "mayPanic":
      case "doesNotReturn":
        break;
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }
}

function validateCallTarget(input: {
  readonly program: ProofMirProgram;
  readonly target: ProofMirCallTarget;
  readonly ownedCallId: ProofMirOwnedCallId;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  switch (input.target.kind) {
    case "sourceFunction": {
      if (!input.program.layout.functions.has(input.target.functionInstanceId)) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_MISSING_FUNCTION_ABI_FACT",
            message: "Source call target is missing a layout function ABI fact.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: `missing-function-abi:${String(input.target.functionInstanceId)}`,
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      }
      break;
    }
    case "certifiedPlatform": {
      const platformEdge = input.program.platformEdges.get(input.target.edgeId);
      if (platformEdge === undefined) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_UNRESOLVED_CALL_TARGET",
            message: "Platform call target references a missing platform contract edge.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: `missing-platform-edge:${proofMetadataIdKey(input.target.edgeId)}`,
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      } else if (platformEdge.primitiveId !== input.target.primitiveId) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_CALL_TARGET_KIND_MISMATCH",
            message: "Platform call target primitive does not match the platform edge record.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: `primitive-mismatch:${String(input.target.primitiveId)}`,
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      }
      if (!input.program.layout.platformEdges.has(input.target.edgeId)) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_MISSING_PLATFORM_ABI_FACT",
            message: "Certified platform call target is missing a layout platform ABI fact.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: `missing-platform-abi:${proofMetadataIdKey(input.target.edgeId)}`,
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      }
      break;
    }
    case "compilerIntrinsic": {
      if (
        input.target.intrinsicKey.length === 0 ||
        input.target.sourceValueKey.length === 0 ||
        input.target.returnTypeKey.length === 0
      ) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_INVALID_CONCRETE_CALL_TARGET",
            message: "Compiler-intrinsic call target is missing stable target metadata.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: "compiler-intrinsic:metadata-missing",
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      }
      break;
    }
    case "compilerRuntime": {
      const operation = input.program.runtimeCatalog.get(input.target.runtimeId);
      if (operation === undefined) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Compiler-runtime call references a missing runtime catalog operation.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: `missing-runtime-operation:${String(input.target.runtimeId)}`,
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      }
      const contract = input.program.runtimeCalls.get(input.target.runtimeCallId);
      if (contract === undefined) {
        input.diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_MISSING_RUNTIME_CALL_CONTRACT",
            message: "Compiler-runtime call is missing an instantiated runtime call contract.",
            ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
            stableDetail: `missing-runtime-call-contract:${String(input.target.runtimeCallId)}`,
            functionInstanceId: input.ownedCallId.functionInstanceId,
          }),
        );
      } else {
        validateRuntimeCallContract({
          program: input.program,
          contract,
          functionInstanceId: input.ownedCallId.functionInstanceId,
          diagnostics: input.diagnostics,
        });
        if (
          contract.runtimeId !== input.target.runtimeId ||
          contract.callId.callId !== input.ownedCallId.callId ||
          contract.callId.functionInstanceId !== input.ownedCallId.functionInstanceId
        ) {
          input.diagnostics.push(
            callDiagnostic({
              code: "PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT",
              message: "Runtime call contract does not match the call statement target.",
              ownerKey: proofMirOwnedCallIdKey(input.ownedCallId),
              stableDetail: `runtime-call-target-mismatch:${String(input.target.runtimeCallId)}`,
              functionInstanceId: input.ownedCallId.functionInstanceId,
            }),
          );
        }
      }
      break;
    }
    default: {
      const unreachable: never = input.target;
      return unreachable;
    }
  }
}

function collectCallStatements(
  function_: ProofMirFunction,
): readonly { callId: ProofMirCallId; target: ProofMirCallTarget }[] {
  const calls: { callId: ProofMirCallId; target: ProofMirCallTarget }[] = [];
  for (const block of function_.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind === "call") {
        calls.push({
          callId: statement.kind.call.callId,
          target: statement.kind.call.target,
        });
      }
    }
  }
  return calls;
}

function findCallGraphEdge(
  program: ProofMirProgram,
  ownedCallId: ProofMirOwnedCallId,
): ProofMirCallGraphEdge | undefined {
  return program.callGraph.get(ownedCallId);
}

export function validateProofMirCalls(program: ProofMirProgram): ProofMirDiagnostic[] {
  const diagnostics: ProofMirDiagnostic[] = [];
  const callStatementsByOwnedId = new Map<string, ProofMirCallTarget>();

  for (const operation of program.runtimeCatalog.entries()) {
    if (runtimeCatalogContainsFunctionLocalIds(operation)) {
      diagnostics.push(
        callDiagnostic({
          code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
          message: "Runtime catalog operation must not contain function-local Proof MIR IDs.",
          ownerKey: "program",
          stableDetail: `runtime-operation:${String(operation.runtimeId)}:function-local-id`,
        }),
      );
    }
  }

  for (const edge of program.callGraph.entries()) {
    validateCallTarget({
      program,
      target: edge.target,
      ownedCallId: edge.callId,
      diagnostics,
    });
  }

  for (const function_ of program.functions.entries()) {
    for (const call of collectCallStatements(function_)) {
      const ownedCallId = {
        functionInstanceId: function_.functionInstanceId,
        callId: call.callId,
      };
      callStatementsByOwnedId.set(proofMirOwnedCallIdKey(ownedCallId), call.target);
      const graphEdge = findCallGraphEdge(program, ownedCallId);
      if (graphEdge === undefined) {
        diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_MISSING_CALL_ID",
            message: "Call statement is missing a matching call graph edge.",
            ownerKey: proofMirOwnedCallIdKey(ownedCallId),
            stableDetail: `missing-call-graph:${String(call.callId)}`,
            functionInstanceId: function_.functionInstanceId,
          }),
        );
        continue;
      }

      if (!callTargetsEqual(graphEdge.target, call.target)) {
        diagnostics.push(
          callDiagnostic({
            code: "PROOF_MIR_UNRESOLVED_CALL_TARGET",
            message: "Call graph edge target does not match the call statement target.",
            ownerKey: proofMirOwnedCallIdKey(ownedCallId),
            stableDetail: `call-target-mismatch:${String(call.callId)}`,
            functionInstanceId: function_.functionInstanceId,
          }),
        );
      }

      validateCallTarget({
        program,
        target: call.target,
        ownedCallId,
        diagnostics,
      });
    }
  }

  for (const edge of program.callGraph.entries()) {
    const ownedCallKey = proofMirOwnedCallIdKey(edge.callId);
    const statementTarget = callStatementsByOwnedId.get(ownedCallKey);
    if (statementTarget === undefined) {
      diagnostics.push(
        callDiagnostic({
          code: "PROOF_MIR_MISSING_CALL_ID",
          message: "Call graph edge has no matching call statement.",
          ownerKey: ownedCallKey,
          stableDetail: `orphan-call-graph:${String(edge.callId.callId)}`,
          functionInstanceId: edge.callId.functionInstanceId,
        }),
      );
      continue;
    }
    if (!callTargetsEqual(edge.target, statementTarget)) {
      diagnostics.push(
        callDiagnostic({
          code: "PROOF_MIR_UNRESOLVED_CALL_TARGET",
          message: "Call graph edge target does not match the call statement target.",
          ownerKey: ownedCallKey,
          stableDetail: `call-target-mismatch:${String(edge.callId.callId)}`,
          functionInstanceId: edge.callId.functionInstanceId,
        }),
      );
    }
  }

  for (const contract of program.runtimeCalls.entries()) {
    const functionInstanceId = contract.callId.functionInstanceId;
    validateRuntimeCallContract({
      program,
      contract,
      functionInstanceId,
      diagnostics,
    });
  }

  return sortProofMirDiagnostics(diagnostics);
}
