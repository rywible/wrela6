import { describe, expect, test } from "bun:test";

import { compileAArch64Object } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineFactId } from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineFunctionForTest } from "../../../../../tests/support/target/aarch64/machine-ir/builders";
import {
  backendInputForTest,
  closedImageBackendPlanForTest,
  machineProgramForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 backend input-contract end-to-end compile", () => {
  test("stale closed-image plan stops before object output", () => {
    const stalePlan = {
      ...closedImageBackendPlanForTest(),
      authorityFingerprint: "stale",
    };
    const result = compileAArch64Object(backendInputForTest({ closedImagePlan: stalePlan }));

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected stale plan error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:stale-authority-fingerprint",
    ]);
  });

  test("invalid fact lineage stops at input contract", () => {
    const result = compileAArch64Object({
      ...backendInputForTest(),
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: ["target.unknown"],
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(9),
            extensionKey: "unknown-proof-family",
            subject: { kind: "region", regionKey: "packet" },
            payload: {},
            upstreamVerifierKey: "proof",
            targetDeclarationKeys: ["target.unknown"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input contract error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:fact-schema:backend-fact-import:unknown-family:unknown-proof-family",
    ]);
    expect(result.verification.runs).toEqual([
      expect.objectContaining({ verifierKey: "input-contract", status: "failed" }),
    ]);
  });

  test("malformed fact verifier keys return input-contract diagnostics instead of throwing", () => {
    const result = compileAArch64Object({
      ...backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [aarch64MachineFunctionForTest()],
        }),
      }),
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: ["target.security"],
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(11),
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 1 },
            payload: { label: "key" },
            upstreamVerifierKey: " proof.security",
            targetDeclarationKeys: ["target.security"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input contract error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:fact-schema:backend-fact-import:malformed-upstream-verifier:security.no-spill:vreg:1: proof.security",
    ]);
  });

  test("stale object fact subjects stop at input contract", () => {
    const result = compileAArch64Object({
      ...backendInputForTest(),
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: ["target.object"],
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(10),
            extensionKey: "object-linkage-and-veneer-policy",
            subject: { kind: "sectionFragment", fragmentKey: "deleted-fragment" } as never,
            payload: { kind: "veneer-policy" },
            upstreamVerifierKey: "layout",
            targetDeclarationKeys: ["target.object"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected stale object fact error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:stale-object-fact-subject:section-fragment:deleted-fragment",
    ]);
    expect(result.verification.runs).toEqual([
      expect.objectContaining({ verifierKey: "input-contract", status: "failed" }),
    ]);
  });
});
