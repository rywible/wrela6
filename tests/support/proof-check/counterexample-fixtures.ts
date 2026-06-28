import type { MonoInstanceId } from "../../../src/mono/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import type { ProofCheckFunctionKernelResult } from "../../../src/proof-check/kernel/checker-kernel";
import type { ProofCheckTransitionWitness } from "../../../src/proof-check/kernel/counterexample-builder";
import type { ProofCheckState } from "../../../src/proof-check/kernel/state";
import type { ProofCheckProgramPoint } from "../../../src/proof-check/kernel/transition-api";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";

export interface ProofCheckCounterexampleFixture {
  readonly program: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryState: ProofCheckState;
  readonly failedLocation: ProofCheckProgramPoint;
  readonly witnesses: readonly ProofCheckTransitionWitness[];
  readonly expectedDiagnosticCode: ReturnType<typeof proofCheckDiagnosticCode>;
  readonly expectedRootCauseKey: string;
  readonly kernelResult: ProofCheckFunctionKernelResult;
}

export function proofCheckCounterexampleFixture(
  input: Omit<ProofCheckCounterexampleFixture, "expectedDiagnosticCode"> & {
    readonly expectedDiagnosticCode: string;
  },
): ProofCheckCounterexampleFixture {
  return {
    ...input,
    expectedDiagnosticCode: proofCheckDiagnosticCode(input.expectedDiagnosticCode),
  };
}
