import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import {
  danglingProofReferenceProgramForMonoTest,
  genericFunctionWithObligationProgramForMonoTest,
  inlineStreamDanglingProofReferenceProgramForMonoTest,
  nestedDanglingProofReferenceProgramForMonoTest,
  terminalCallDanglingClosureObligationProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

test("same generic function proof ids are distinct per concrete instance", () => {
  const result = monomorphizeWholeImage({
    program: genericFunctionWithObligationProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const obligationIds = result.program.proofMetadata.obligations
      .entries()
      .map((entry) => `${entry.obligationId.hirId}:${entry.obligationId.instanceId}`);

    expect(new Set(obligationIds).size).toBe(obligationIds.length);
    expect(obligationIds.length).toBeGreaterThan(1);
  }
});

test("dangling proof metadata reference is rejected", () => {
  const result = monomorphizeWholeImage({ program: danglingProofReferenceProgramForMonoTest() });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    monoDiagnosticCode("MONO_DANGLING_PROOF_METADATA"),
  );
});

test("nested dangling proof metadata reference is rejected", () => {
  const result = monomorphizeWholeImage({
    program: nestedDanglingProofReferenceProgramForMonoTest(),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    monoDiagnosticCode("MONO_DANGLING_PROOF_METADATA"),
  );
});

test("terminal call dangling closure obligation is rejected", () => {
  const result = monomorphizeWholeImage({
    program: terminalCallDanglingClosureObligationProgramForMonoTest(),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    monoDiagnosticCode("MONO_DANGLING_PROOF_METADATA"),
  );
});

test("inline stream proof references are checked against proof metadata", () => {
  const result = monomorphizeWholeImage({
    program: inlineStreamDanglingProofReferenceProgramForMonoTest(),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    monoDiagnosticCode("MONO_DANGLING_PROOF_METADATA"),
  );
});
