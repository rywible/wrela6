import { expect, test } from "bun:test";
import { HirProofMetadataBuilder } from "../../../src/hir/proof-metadata";
import type { HirPlatformContractEdge, TypedHirProgram } from "../../../src/hir/hir";
import { hirExpressionId, hirOriginId, ownedHirPlatformContractEdgeId } from "../../../src/hir/ids";
import { collectReachablePlatformPrimitiveIds } from "../../../src/mono/platform-primitives";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import { targetWithCertifiedExit } from "../../support/hir/typed-hir-fakes";
import {
  duplicatePlatformEdgesProgramForMonoTest,
  monomorphizedProgramWithPlatformEdgesForTest,
  platformPrimitiveReachabilityProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

function withPlatformEdges(
  program: TypedHirProgram,
  platformEdges: readonly HirPlatformContractEdge[],
): TypedHirProgram {
  const builder = new HirProofMetadataBuilder();
  for (const obligation of program.proofMetadata.obligations.entries()) {
    builder.addObligation(obligation);
  }
  for (const session of program.proofMetadata.sessions.entries()) {
    builder.addSession(session);
  }
  for (const brand of program.proofMetadata.brands.entries()) {
    builder.addBrand(brand);
  }
  for (const place of program.proofMetadata.resourcePlaces.entries()) {
    builder.addResourcePlace(place);
  }
  for (const requirement of program.proofMetadata.callSiteRequirements.entries()) {
    builder.addCallSiteRequirement(requirement);
  }
  for (const validation of program.proofMetadata.validations.entries()) {
    builder.addValidation(validation);
  }
  for (const attempt of program.proofMetadata.attempts.entries()) {
    builder.addAttempt(attempt);
  }
  for (const terminalCall of program.proofMetadata.terminalCalls.entries()) {
    builder.addTerminalCall(terminalCall);
  }
  for (const transition of program.proofMetadata.privateStateTransitions.entries()) {
    builder.addPrivateStateTransition(transition);
  }
  for (const factOrigin of program.proofMetadata.factOrigins.entries()) {
    builder.addFactOrigin(factOrigin);
  }
  for (const edge of platformEdges) {
    builder.addPlatformContractEdge(edge);
  }
  for (const imageOrigin of program.proofMetadata.imageOrigins.entries()) {
    builder.addImageOrigin(imageOrigin);
  }
  return { ...program, proofMetadata: builder.build() };
}

function withMismatchedEnsuredFact(program: TypedHirProgram): TypedHirProgram {
  const existingEdge = program.proofMetadata.platformContractEdges.entries()[0];
  if (existingEdge === undefined) throw new Error("expected platform edge");
  const mutatedEdge: HirPlatformContractEdge = {
    ...existingEdge,
    ensuredFacts: [
      ...existingEdge.ensuredFacts,
      {
        sourceFunctionId: existingEdge.sourceFunctionId,
        primitiveId: existingEdge.primitiveId,
        contractId: existingEdge.contractId,
        targetId: existingEdge.targetId,
        fingerprint: "bogus-extra-fact",
        fact: { kind: "state", stateKind: "closed", argumentBindings: [] },
      },
    ],
  };
  return withPlatformEdges(
    program,
    program.proofMetadata.platformContractEdges
      .entries()
      .map((edge) => (edge.edgeId.id === existingEdge.edgeId.id ? mutatedEdge : edge)),
  );
}

function stalePlatformEdgeProgram(): TypedHirProgram {
  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        [
          "platform fn exit() -> Never",
          "uefi image Boot:",
          "    fn main() -> Never:",
          "        return",
        ].join("\n"),
      ],
    ],
    {
      platformNames: ["exit"],
      targetSurface: targetWithCertifiedExit(),
    },
  );
  const program = result.program;
  const image = program.images.entries()[0];
  const sourceFunctionId = image?.entryFunctionId;
  const binding = program.monoClosure.certifiedPlatformBindings.entries()[0];
  if (sourceFunctionId === undefined || binding === undefined) {
    throw new Error("expected image entry and certified platform binding");
  }
  const staleEdge: HirPlatformContractEdge = {
    edgeId: ownedHirPlatformContractEdgeId({ kind: "function", functionId: sourceFunctionId }, 0),
    sourceFunctionId: binding.functionId,
    primitiveId: binding.primitiveId,
    contractId: binding.contractId,
    targetId: binding.targetId,
    certificate: binding.certificate,
    callExpressionId: hirExpressionId(999),
    ensuredFacts: (binding.ensuredFacts ?? []).map((ensuredFact) => ({
      sourceFunctionId: binding.functionId,
      primitiveId: binding.primitiveId,
      contractId: binding.contractId,
      targetId: binding.targetId,
      fingerprint: ensuredFact.fingerprint,
      fact: ensuredFact.fact,
    })),
    sourceOrigin: program.origins.originRecords()[0]?.originId ?? hirOriginId(0),
  };
  return withPlatformEdges(
    {
      ...program,
      monoClosure: {
        ...program.monoClosure,
        externalEntryRoots: program.monoClosure.externalEntryRoots.filter(
          (root) => root.reason === "imageEntry",
        ),
      },
    },
    [staleEdge],
  );
}

test("reachable primitive ids are derived from mono platform edges", () => {
  const program = monomorphizedProgramWithPlatformEdgesForTest(["z_write", "a_read", "z_write"]);
  const primitiveIds = collectReachablePlatformPrimitiveIds(program);

  expect(primitiveIds.map(String)).toEqual(["a_read", "z_write"]);
});

test("duplicate HIR platform edges for one call are rejected", () => {
  const result = monomorphizeWholeImage({ program: duplicatePlatformEdgesProgramForMonoTest() });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    monoDiagnosticCode("MONO_DUPLICATE_PLATFORM_CONTRACT_EDGE"),
  );
});

test("platform edge ensured facts must match certified binding facts", () => {
  const result = monomorphizeWholeImage({
    program: withMismatchedEnsuredFact(platformPrimitiveReachabilityProgramForMonoTest()),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    monoDiagnosticCode("MONO_INCONSISTENT_PLATFORM_ENSURED_FACT"),
  );
});

test("stale platform metadata edge without a reachable call is not retained", () => {
  const result = monomorphizeWholeImage({ program: stalePlatformEdgeProgram() });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.proofMetadata.platformContractEdges.entries()).toEqual([]);
    expect(result.reachablePlatformPrimitiveIds).toEqual([]);
  }
});
