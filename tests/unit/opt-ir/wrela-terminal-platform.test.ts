import { describe, expect, test } from "bun:test";

import { optIrCallId, optIrOperationId, optIrOriginId } from "../../../src/opt-ir/ids";
import {
  optIrPlatformCallOperation,
  optIrRuntimeCallOperation,
} from "../../../src/opt-ir/operations";
import { runWrelaTerminalPlatformSpecializationForTest } from "../../../src/opt-ir/passes/wrela-optimizations";

describe("Wrela terminal cleanup and platform specialization", () => {
  test("prunes only unobservable terminal cleanup and keeps platform/runtime cleanup calls", () => {
    const deadCleanup = runtimeCall(1);
    const observableCleanup = runtimeCall(2);
    const result = runWrelaTerminalPlatformSpecializationForTest({
      operations: [deadCleanup, observableCleanup],
      terminalCleanupCandidates: [
        {
          operationId: deadCleanup.operationId,
          observable: false,
          platformOrRuntimeCleanup: false,
          factChain: ["terminal-unreachable"],
        },
        {
          operationId: observableCleanup.operationId,
          observable: true,
          platformOrRuntimeCleanup: true,
          factChain: ["terminal-unreachable"],
        },
      ],
    });

    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      observableCleanup.operationId,
    ]);
    expect(result.rejectedCleanups).toEqual([
      { operationId: observableCleanup.operationId, reason: "observableCleanupCall" },
    ]);
  });

  test("specializes platform calls only with constants, ABI facts, and catalog equivalence", () => {
    const specialized = platformCall(1);
    const rejected = platformCall(2);
    const result = runWrelaTerminalPlatformSpecializationForTest({
      operations: [specialized, rejected],
      platformSpecializationCandidates: [
        {
          operationId: specialized.operationId,
          constantArgumentFactIds: ["const:fd"],
          abiFactIds: ["abi:wrela"],
          targetCatalogEquivalent: true,
          specializedTargetKey: "uefi.write.const",
        },
        {
          operationId: rejected.operationId,
          constantArgumentFactIds: ["const:fd"],
          abiFactIds: ["abi:wrela"],
          targetCatalogEquivalent: false,
          specializedTargetKey: "uefi.write.const",
        },
      ],
    });

    expect(result.specializedPlatformCalls).toEqual([
      { operationId: specialized.operationId, specializedTargetKey: "uefi.write.const" },
    ]);
    expect(result.rejectedSpecializations).toEqual([
      { operationId: rejected.operationId, reason: "missingTargetCatalogEquivalence" },
    ]);
    expect(result.explanations[0]).toMatchObject({
      kind: "platformCallSpecialized",
      factChain: ["const:fd", "abi:wrela", "target-catalog-equivalence"],
    });
  });
});

function runtimeCall(operationId: number) {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "runtime", runtimeKey: `runtime.cleanup.${operationId}` },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}

function platformCall(operationId: number) {
  return optIrPlatformCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "platform", platformKey: `platform.${operationId}` },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}
