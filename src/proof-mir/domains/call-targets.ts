import type { LayoutFactProgram } from "../../layout/layout-program";
import { instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type {
  MonoCallExpression,
  MonoExpressionId,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import { buildMonomorphicPlatformEdgeKey } from "../../mono/platform-contract-edge";
import { lookupMonoResolvedCallTarget } from "../../mono/resolved-call-targets";
import { runtimeOperationAvailableOnTarget } from "../../runtime/runtime-catalog";
import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import type { TargetId } from "../../semantic/ids";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type { ProofMirRuntimeCallId, ProofMirRuntimeOperationId } from "../ids";
import type { ProofMirCallTarget } from "../model/calls";
import { proofMirOriginOwnerKey, type ProofMirOriginOwner } from "./origin-map";

export interface ProofMirCallTargetBuildTargetContext {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
}

export interface CreateProofMirCallTargetIndexInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: ProofMirCallTargetBuildTargetContext;
  readonly callerFunctionInstanceId?: MonoInstanceId;
}

export type ProofMirCallTargetResolveResult =
  | { readonly kind: "ok"; readonly target: ProofMirCallTarget }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface ProofMirCallTargetIndex {
  resolveMonoCall(input: {
    readonly call: MonoCallExpression;
    readonly monoExpressionId: MonoExpressionId;
  }): ProofMirCallTargetResolveResult;
  resolveCompilerRuntime(input: {
    readonly runtimeId: ProofMirRuntimeOperationId;
    readonly runtimeCallId: ProofMirRuntimeCallId;
    readonly callerFunctionInstanceId: MonoInstanceId;
  }): ProofMirCallTargetResolveResult;
}

function resolveError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirCallTargetResolveResult {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function callTargetDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  const owner: ProofMirOriginOwner = {
    kind: "function",
    functionInstanceId: input.callerFunctionInstanceId,
  };
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: proofMirOriginOwnerKey(owner),
    rootCauseKey: "call-target",
    stableDetail: input.stableDetail,
    functionInstanceId: input.callerFunctionInstanceId,
  });
}

export function createProofMirCallTargetIndex(
  input: CreateProofMirCallTargetIndexInput,
): ProofMirCallTargetIndex {
  const defaultCallerFunctionInstanceId = input.callerFunctionInstanceId;

  function callerFunctionInstanceIdOrThrow(): MonoInstanceId {
    if (defaultCallerFunctionInstanceId === undefined) {
      throw new RangeError(
        "ProofMirCallTargetIndex.resolveMonoCall requires callerFunctionInstanceId on index creation.",
      );
    }
    return defaultCallerFunctionInstanceId;
  }

  return {
    resolveMonoCall(resolveInput) {
      const call = resolveInput.call;
      const monoExpressionId = resolveInput.monoExpressionId;
      const callerFunctionInstanceId = callerFunctionInstanceIdOrThrow();

      if (call.recovered === true) {
        return resolveError([
          callTargetDiagnostic({
            code: "PROOF_MIR_INVALID_CONCRETE_CALL_TARGET",
            message: "Recovered mono call cannot be lowered to Proof MIR.",
            callerFunctionInstanceId,
            stableDetail: "recovered-call",
          }),
        ]);
      }

      const resolvedTarget = lookupMonoResolvedCallTarget({
        table: input.program.resolvedCallTargets,
        callerInstanceId: callerFunctionInstanceId,
        callExpressionId: monoExpressionId,
      });
      if (resolvedTarget === undefined) {
        return resolveError([
          callTargetDiagnostic({
            code: "PROOF_MIR_MISSING_CONCRETE_CALL_TARGET",
            message: "Mono call is missing a concrete resolved target.",
            callerFunctionInstanceId,
            stableDetail: "missing-resolved-target",
          }),
        ]);
      }

      switch (resolvedTarget.kind) {
        case "sourceFunction": {
          const targetFunctionInstanceId = resolvedTarget.targetFunctionInstanceId;
          const functionInstance = input.program.functions.get(targetFunctionInstanceId);
          if (functionInstance === undefined) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_UNRESOLVED_CALL_TARGET",
                message: "Resolved source function instance was not found in the mono program.",
                callerFunctionInstanceId,
                stableDetail: `unresolved-target:${String(targetFunctionInstanceId)}`,
              }),
            ]);
          }
          if (functionInstance.bodyStatus !== "sourceBody") {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_CALL_TARGET_KIND_MISMATCH",
                message: "Resolved call target is not a source-bodied function.",
                callerFunctionInstanceId,
                stableDetail: `body-status:${functionInstance.bodyStatus}`,
              }),
            ]);
          }
          const functionAbi = input.layout.functions.get(targetFunctionInstanceId);
          if (functionAbi === undefined) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_MISSING_FUNCTION_ABI_FACT",
                message: "Source call target is missing a layout function ABI fact.",
                callerFunctionInstanceId,
                stableDetail: `missing-function-abi:${String(targetFunctionInstanceId)}`,
              }),
            ]);
          }
          return {
            kind: "ok",
            target: {
              kind: "sourceFunction",
              functionInstanceId: targetFunctionInstanceId,
              abi: { kind: "functionAbi", functionInstanceId: targetFunctionInstanceId },
            },
          };
        }
        case "certifiedPlatform": {
          const edgeId = resolvedTarget.targetPlatformEdgeId;
          const platformEdge = input.program.proofMetadata.platformContractEdges.get(edgeId);
          if (platformEdge === undefined) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_UNRESOLVED_CALL_TARGET",
                message: "Resolved platform contract edge was not found in mono proof metadata.",
                callerFunctionInstanceId,
                stableDetail: `unresolved-edge:${proofMetadataIdKey(edgeId)}`,
              }),
            ]);
          }
          if (platformEdge.primitiveId !== resolvedTarget.primitiveId) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_CALL_TARGET_KIND_MISMATCH",
                message:
                  "Resolved platform call target primitive does not match the contract edge.",
                callerFunctionInstanceId,
                stableDetail: `primitive-mismatch:${String(resolvedTarget.primitiveId)}:${String(platformEdge.primitiveId)}`,
              }),
            ]);
          }
          if (
            instantiatedHirIdKey(platformEdge.callExpressionId) !==
            instantiatedHirIdKey(monoExpressionId)
          ) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_CALL_TARGET_KIND_MISMATCH",
                message: "Resolved platform contract edge does not match the call expression id.",
                callerFunctionInstanceId,
                stableDetail: `call-expression-mismatch:${instantiatedHirIdKey(monoExpressionId)}:${instantiatedHirIdKey(platformEdge.callExpressionId)}`,
              }),
            ]);
          }
          const expectedMonomorphicEdgeKey = buildMonomorphicPlatformEdgeKey({
            callerInstanceId: callerFunctionInstanceId,
            callExpressionId: monoExpressionId,
            calleeFunctionId: platformEdge.sourceFunctionId,
            ownerTypeArguments: call.ownerTypeArguments,
            functionTypeArguments: call.typeArguments,
          });
          if (platformEdge.monomorphicEdgeKey !== expectedMonomorphicEdgeKey) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_CALL_TARGET_KIND_MISMATCH",
                message:
                  "Resolved platform contract edge monomorphic key does not match the call site.",
                callerFunctionInstanceId,
                stableDetail: `monomorphic-key-mismatch:${String(platformEdge.monomorphicEdgeKey)}:${String(expectedMonomorphicEdgeKey)}`,
              }),
            ]);
          }
          const platformAbi = input.layout.platformEdges.get(edgeId);
          if (platformAbi === undefined) {
            return resolveError([
              callTargetDiagnostic({
                code: "PROOF_MIR_MISSING_PLATFORM_ABI_FACT",
                message: "Certified platform call target is missing a layout platform ABI fact.",
                callerFunctionInstanceId,
                stableDetail: `missing-platform-abi:${proofMetadataIdKey(edgeId)}`,
              }),
            ]);
          }
          return {
            kind: "ok",
            target: {
              kind: "certifiedPlatform",
              edgeId,
              primitiveId: resolvedTarget.primitiveId,
              abi: { kind: "platformAbi", edgeId },
            },
          };
        }
        default: {
          const unreachable: never = resolvedTarget;
          return unreachable;
        }
      }
    },

    resolveCompilerRuntime(runtimeInput) {
      const operation = input.target.runtimeCatalog.get(runtimeInput.runtimeId);
      if (operation === undefined) {
        return resolveError([
          callTargetDiagnostic({
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Runtime catalog does not define the requested operation.",
            callerFunctionInstanceId: runtimeInput.callerFunctionInstanceId,
            stableDetail: `missing-runtime-operation:${String(runtimeInput.runtimeId)}`,
          }),
        ]);
      }
      if (
        !runtimeOperationAvailableOnTarget({
          operation,
          targetId: input.target.targetId,
          features: input.target.features,
        })
      ) {
        return resolveError([
          callTargetDiagnostic({
            code: "PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE",
            message: "Runtime operation is not available on the selected target.",
            callerFunctionInstanceId: runtimeInput.callerFunctionInstanceId,
            stableDetail: `runtime-unavailable:${String(runtimeInput.runtimeId)}`,
          }),
        ]);
      }
      return {
        kind: "ok",
        target: {
          kind: "compilerRuntime",
          runtimeId: runtimeInput.runtimeId,
          runtimeCallId: runtimeInput.runtimeCallId,
        },
      };
    },
  };
}
