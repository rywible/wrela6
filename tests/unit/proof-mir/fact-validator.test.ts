import { describe, expect, test } from "bun:test";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoProofMetadata } from "../../../src/mono/mono-hir";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  proofMirCallId,
  proofMirFactId,
  proofMirOriginId,
  proofMirPrivateStateGenerationId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
  proofMirOwnedCallId,
} from "../../../src/proof-mir/ids";
import type { ProofMirRuntimeCallContract } from "../../../src/proof-mir/model/calls";
import type {
  ProofMirFact,
  ProofMirFactDependency,
  ProofMirFactKind,
  ProofMirFactRole,
} from "../../../src/proof-mir/model/facts";
import type { ProofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";
import { validateProofMirFacts } from "../../../src/proof-mir/validation/fact-validator";

function emptyDeterministicTable<Key, Value>(): ProofMirDeterministicTable<Key, Value> {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyOf: () => proofMirCanonicalKey("empty"),
    lookupKeyOf: () => proofMirCanonicalKey("empty"),
  };
}

function factTable(entries: readonly ProofMirFact[]) {
  const result = proofMirDeterministicTable({
    entries,
    keyOf: (entry) => proofMirCanonicalKey(`fact:${String(entry.factId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`fact:${String(id)}`),
    normalizePayload: (entry) => `${entry.role}:${entry.kind.kind}`,
  });
  if (result.kind !== "ok") {
    throw new Error("fact table failed");
  }
  return result.table;
}

function runtimeCallTable(entries: readonly ProofMirRuntimeCallContract[]) {
  const result = proofMirDeterministicTable({
    entries,
    keyOf: (entry) => proofMirCanonicalKey(`runtimeCall:${String(entry.runtimeCallId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`runtimeCall:${String(id)}`),
    normalizePayload: (entry) => String(entry.runtimeCallId),
  });
  if (result.kind !== "ok") {
    throw new Error("runtime call table failed");
  }
  return result.table;
}

function proofMirProgramWithFactForTest(input: {
  readonly role: ProofMirFactRole;
  readonly kind: ProofMirFactKind;
  readonly dependsOn: readonly ProofMirFactDependency[];
  readonly extraFacts?: readonly ProofMirFact[];
  readonly runtimeCalls?: ProofMirProgram["runtimeCalls"];
}): ProofMirProgram {
  const factId = proofMirFactId(0);
  const fact: ProofMirFact = {
    factId,
    role: input.role,
    kind: input.kind,
    origin: proofMirOriginId(0),
    dependsOn: input.dependsOn,
  };
  const imageInstanceId = monoInstanceId("image:main");
  return {
    image: {
      imageInstanceId,
      entryFunctionInstanceId: monoInstanceId("function:main"),
      externalRoots: [],
      layout: { kind: "imageEntryAbi", imageInstanceId },
      origin: proofMirOriginId(0),
    },
    functions: emptyDeterministicTable(),
    layout: {} as LayoutFactProgram,
    proofMetadata: {} as MonoProofMetadata,
    origins: emptyDeterministicTable(),
    facts: factTable([fact, ...(input.extraFacts ?? [])]),
    layoutTerms: emptyDeterministicTable(),
    privateStateGenerations: emptyDeterministicTable(),
    callGraph: emptyDeterministicTable(),
    platformEdges: emptyDeterministicTable(),
    runtimeCatalog: {
      targetId: "x64-test" as never,
      features: [],
      get: () => undefined,
      entries: () => [],
    } satisfies ProofMirRuntimeCatalog,
    runtimeCalls: input.runtimeCalls ?? emptyDeterministicTable(),
  };
}

describe("validateProofMirFacts", () => {
  test("trusted axiom without catalog dependency is rejected", () => {
    const program = proofMirProgramWithFactForTest({
      role: "trustedAxiom",
      kind: { kind: "runtimeEnsured", runtimeCallId: proofMirRuntimeCallId(0) },
      dependsOn: [],
    });

    const diagnostics = validateProofMirFacts(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_FACT_AUTHORITY"),
    );
  });

  test("trusted axiom with matching runtime-call dependency is accepted", () => {
    const runtimeCallId = proofMirRuntimeCallId(0);
    const program = proofMirProgramWithFactForTest({
      role: "trustedAxiom",
      kind: { kind: "runtimeEnsured", runtimeCallId },
      dependsOn: [{ kind: "runtimeCall", runtimeCallId }],
      runtimeCalls: runtimeCallTable([
        {
          runtimeCallId,
          runtimeId: proofMirRuntimeOperationId(0),
          callId: proofMirOwnedCallId(monoInstanceId("function:main"), proofMirCallId(0)),
          requiredFacts: [],
          consumedCapabilities: [],
          producedCapabilities: [],
          effects: [{ kind: "pure" }],
          origin: proofMirOriginId(1),
        },
      ]),
    });

    const diagnostics = validateProofMirFacts(program);

    expect(diagnostics).toEqual([]);
  });

  test("missing fact dependency reference is rejected", () => {
    const program = proofMirProgramWithFactForTest({
      role: "requirement",
      kind: {
        kind: "comparison",
        left: { kind: "bool", value: true },
        operator: "eq",
        right: { kind: "bool", value: true },
      },
      dependsOn: [{ kind: "fact", factId: proofMirFactId(99) }],
    });

    const diagnostics = validateProofMirFacts(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_FACT_TABLE_REFERENCE"),
    );
  });

  test("denormalized fact operands are rejected", () => {
    const program = proofMirProgramWithFactForTest({
      role: "evidence",
      kind: {
        kind: "comparison",
        left: { kind: "bool", value: true },
        operator: "eq",
        right: { kind: "constant", literal: { kind: "bool", value: true } },
      },
      dependsOn: [],
    });

    const diagnostics = validateProofMirFacts(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_FACT_OPERAND"),
    );
  });

  test("invalid fact roles are rejected", () => {
    const program = proofMirProgramWithFactForTest({
      role: "unsupportedRole" as never,
      kind: {
        kind: "comparison",
        left: { kind: "bool", value: true },
        operator: "eq",
        right: { kind: "bool", value: true },
      },
      dependsOn: [],
    });

    const diagnostics = validateProofMirFacts(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_FACT_ROLE"),
    );
  });

  test("missing private-state generation dependency is rejected", () => {
    const program = proofMirProgramWithFactForTest({
      role: "requirement",
      kind: {
        kind: "comparison",
        left: { kind: "bool", value: true },
        operator: "eq",
        right: { kind: "bool", value: true },
      },
      dependsOn: [
        {
          kind: "privateState",
          generation: {
            generationId: proofMirPrivateStateGenerationId(7),
            place: {
              functionInstanceId: monoInstanceId("function:main"),
              placeId: 0 as never,
            },
            origin: proofMirOriginId(1),
          },
        },
      ],
    });

    const diagnostics = validateProofMirFacts(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_PRIVATE_STATE_GENERATION"),
    );
  });
});
