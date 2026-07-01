import {
  emptyAArch64PreservedFactSet,
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64MachineFactId,
  aarch64MachineProgramId,
  aarch64SymbolId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineProgram } from "../../../../../src/target/aarch64/machine-ir/machine-program";
import type { AArch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import { emptyAArch64ProvenanceMap } from "../../../../../src/target/aarch64/machine-ir/provenance";
import type { AArch64SymbolReference } from "../../../../../src/target/aarch64/machine-ir/symbol-reference";
import type { CompileAArch64ObjectInput } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import {
  aarch64BarrierForTest,
  aarch64LdrUnsignedImmediateForTest,
  aarch64MachineFunctionForTest,
  aarch64Rev16ForTest,
} from "../machine-ir/builders";
import {
  authenticatedBackendTargetSurfaceForTest,
  fakeBackendSurfaceAuthenticationInput,
} from "./backend-target-surface-fakes";
import {
  closedImageBackendPlanForTest,
  singleFunctionMachineProgramForTest,
} from "./closed-image-plan-fakes";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
} from "./object-module-fixtures";
import type { BackendInputForTestOptions } from "./backend-fixture-contract";

export {
  authenticatedBackendTargetSurfaceForTest,
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  closedImageBackendPlanForTest,
  relocationForTest,
  sectionForTest,
  singleFunctionMachineProgramForTest,
  symbolForTest,
};

export function machineProgramForTest(
  input: {
    readonly targetFingerprint?: string;
    readonly functions?: readonly AArch64MachineFunction[];
    readonly globalSymbols?: readonly AArch64SymbolReference[];
  } = {},
) {
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: input.functions ?? [],
    globalSymbols: input.globalSymbols ?? [],
    entrySymbol: aarch64SymbolId("entry"),
    targetFingerprint:
      input.targetFingerprint ??
      authenticatedBackendTargetSurfaceForTest().sourceSurfaceFingerprint,
    consultedSubsurfaceFingerprints: [],
    provenance: emptyAArch64ProvenanceMap(),
  });
}

export function backendInputForTest(
  options: BackendInputForTestOptions = {},
): CompileAArch64ObjectInput {
  const target = options.target ?? authenticatedBackendTargetSurfaceForTest();
  return Object.freeze({
    machineProgram:
      options.machineProgram ??
      machineProgramForTest({ targetFingerprint: target.sourceSurfaceFingerprint }),
    preservedFacts: options.preservedFacts ?? emptyAArch64PreservedFactSet(),
    provenance: emptyAArch64ProvenanceMap(),
    target,
    closedImagePlan: options.closedImagePlan ?? closedImageBackendPlanForTest(),
    diagnosticMode: "default",
    debugArtifacts: options.debugArtifacts ?? {},
  });
}

export function staleBackendTargetSurfaceForTest() {
  return {
    ...authenticatedBackendTargetSurfaceForTest(fakeBackendSurfaceAuthenticationInput()),
    sourceSurfaceFingerprint: "stale:target",
    backendSurfaceFingerprint: "stale:backend",
  };
}

export function packetLoopBackendInputForTest(): CompileAArch64ObjectInput {
  const target = authenticatedBackendTargetSurfaceForTest();
  return {
    ...backendInputForTest({
      target,
      machineProgram: machineProgramForTest({
        targetFingerprint: target.sourceSurfaceFingerprint,
        functions: [
          aarch64MachineFunctionForTest({
            symbol: "packet.loop",
            instructions: [
              aarch64LdrUnsignedImmediateForTest({
                instructionId: 1,
                destination: 0,
                base: 1,
                offsetBytes: 16n,
                originStableKey: "packet.field.ethertype",
              }),
              aarch64Rev16ForTest({
                instructionId: 2,
                destination: 2,
                source: 0,
                originStableKey: "packet.field.ethertype.endian",
              }),
              aarch64BarrierForTest({
                instructionId: 3,
                opcode: "dmb",
                originStableKey: "packet.loop.barrier.dmb",
              }),
              aarch64BarrierForTest({
                instructionId: 4,
                opcode: "dsb",
                originStableKey: "packet.loop.barrier.dsb",
              }),
            ],
          }),
        ],
      }),
      closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
    }),
    preservedFacts: aarch64PreservedFactSet({
      targetDeclarations: [
        "target.region",
        "target.memory-order",
        "target.scheduler",
        "target.epilogue",
      ],
      records: [
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(1),
          extensionKey: "validated-region-shape",
          subject: { kind: "region", regionKey: "packet.field.ethertype" },
          payload: { region: "packet.field.ethertype", endian: "big" },
          upstreamVerifierKey: "proof.layout",
          targetDeclarationKeys: ["target.region"],
        }),
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(2),
          extensionKey: "memory-order-and-region-type",
          subject: { kind: "memoryOperand", instructionId: 1, operandIndex: 1 },
          payload: {
            region: "packet.field.ethertype",
            order: "acquire",
            regionType: "device",
          },
          upstreamVerifierKey: "proof.memory-order",
          targetDeclarationKeys: ["target.memory-order"],
        }),
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(3),
          extensionKey: "core-owner-and-transfer",
          subject: { kind: "virtualRegister", vreg: 1 },
          payload: { owner: "core:0", transfer: "pinned-packet-base" },
          upstreamVerifierKey: "scheduler",
          targetDeclarationKeys: ["target.scheduler"],
        }),
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(4),
          extensionKey: "terminal-exit-and-cleanup",
          subject: { kind: "machineBlock", blockId: 0 },
          payload: { exit: "return", cleanup: "barrier-sequence:dmb,dsb" },
          upstreamVerifierKey: "epilogue",
          targetDeclarationKeys: ["target.epilogue"],
        }),
      ],
    }),
  };
}
