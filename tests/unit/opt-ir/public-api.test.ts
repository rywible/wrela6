import { describe, expect, test } from "bun:test";

import * as optIrBarrel from "../../../src/opt-ir";
import * as topLevelExports from "../../../src";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { buildOptimizedOptIr, constructOptIr } from "../../../src/opt-ir/public-api";
import { createOptIrFactQuery } from "../../../src/opt-ir/facts/fact-query";
import { optIrPathCertificateId } from "../../../src/opt-ir/ids";
import { productionOptimizationPolicyForTest } from "../../../src/opt-ir/policy/optimization-profile";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import { proofMirControlEdgeId, proofMirValueId } from "../../../src/proof-mir/ids";
import {
  constructOptIrInputWithMismatchedCapabilityFlowCallForTest,
  constructOptIrInputWithMissingValidatedBufferAuthorityForTest,
  invalidBoundaryConstructOptIrInputForTest,
  stableOptIrConstructionKey,
  validConstructOptIrInputWithCapabilityFlowCallForTest,
  validConstructOptIrInputWithEntryParameterLoadForTest,
  validConstructOptIrInputWithProofOnlyDependentFactsForTest,
  validConstructOptIrInputWithPreservedNoaliasWitnessForTest,
  validConstructOptIrInputWithOrphanNoaliasWitnessForTest,
  validConstructOptIrInputWithProofOnlyStatementForTest,
  validConstructOptIrInputWithProofOnlyValueFactForTest,
  validConstructOptIrInputWithValidatedBufferReadForTest,
  validConstructOptIrInputForTest,
} from "../../support/opt-ir/construction-fixtures";

describe("OptIR public construction API", () => {
  test("constructOptIr returns a program, imported facts, provenance snapshot, and diagnostics", () => {
    const result = constructOptIr(validConstructOptIrInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    expect(result.program.functions.entries()).toHaveLength(1);
    expect(result.facts.records).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "construction-cleanup",
    ]);
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "OPT_IR_CONSTRUCTION_TRACE",
    ]);
    expect(result.provenance.originIds).toEqual(result.program.provenance.originIds);
    expect(result.provenance.fingerprint.digestHex).toHaveLength(64);
    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
  });

  test("construction output is stable across repeated public API calls", () => {
    const first = constructOptIr(validConstructOptIrInputForTest());
    const second = constructOptIr(validConstructOptIrInputForTest());

    expect(stableOptIrConstructionKey(first)).toBe(stableOptIrConstructionKey(second));
  });

  test("buildOptimizedOptIr composes construction and optimization", () => {
    const result = buildOptimizedOptIr({
      ...validConstructOptIrInputForTest(),
      policy: productionOptimizationPolicyForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected optimized construction to succeed.");
    }
    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "construction-cleanup",
    );
  });

  test("constructOptIr imports capability-flow facts backed by checked MIR call graph evidence", () => {
    const result = constructOptIr(validConstructOptIrInputWithCapabilityFlowCallForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to import the call-backed fact.");
    }

    expect(result.facts.records.map((record) => record.packetKind)).toEqual(["capabilityFlow"]);
  });

  test("constructOptIr attaches checked summaries and mandatory inline policies to functions", () => {
    const input = validConstructOptIrInputForTest();
    const result = constructOptIr(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to preserve function summary metadata.");
    }

    const policy = input.handoff.semanticInlinePolicies[0];
    if (policy === undefined) {
      throw new Error("Expected fixture handoff to include a semantic inline policy.");
    }
    const function_ = result.program.functions
      .entries()
      .find((entry) => entry.monoInstanceId === policy.functionInstanceId);
    if (function_ === undefined) {
      throw new Error("Expected constructed function for inline policy.");
    }
    const summary = function_.summary as
      | {
          readonly functionInstanceId?: unknown;
          readonly semanticInlinePolicy?: {
            readonly kind?: unknown;
            readonly source?: unknown;
            readonly certificateId?: unknown;
          };
        }
      | undefined;

    expect(summary?.functionInstanceId).toBe(policy.functionInstanceId);
    expect(summary?.semanticInlinePolicy).toMatchObject({
      kind: "mandatory",
      source: "checkedSummary",
      certificateId: policy.summaryCertificateId,
    });
  });

  test("constructOptIr attaches checked external roots to functions", () => {
    const input = validConstructOptIrInputForTest();
    const result = constructOptIr(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to preserve external root metadata.");
    }

    const externalRoot = input.handoff.checkedMir.mir.image.externalRoots[0];
    if (externalRoot === undefined) {
      throw new Error("Expected fixture handoff to include an image entry external root.");
    }
    const function_ = result.program.functions
      .entries()
      .find((entry) => entry.monoInstanceId === externalRoot.functionInstanceId);
    if (function_ === undefined) {
      throw new Error("Expected constructed function for external root.");
    }

    expect(function_.externalRoot).toEqual({
      reason: externalRoot.reason,
      originId: function_.originId,
    });
  });

  test("constructOptIr rejects call facts for the wrong checked MIR caller", () => {
    const result = constructOptIr(constructOptIrInputWithMismatchedCapabilityFlowCallForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected mismatched call owner to fail fact import.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH"),
    );
  });

  test("constructOptIr erases proof-only marker operations before exposing the program", () => {
    const result = constructOptIr(validConstructOptIrInputWithProofOnlyStatementForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to erase proof-only markers.");
    }

    expect(result.program.operations?.map((operation) => operation.kind)).not.toContain(
      "proofErasedMarker",
    );
  });

  test("constructOptIr preserves erasure facts for proof-only values through valid lineage", () => {
    const result = constructOptIr(validConstructOptIrInputWithProofOnlyValueFactForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to preserve proof-only erasure facts.");
    }

    expect(result.facts.records).toHaveLength(1);
    expect(result.facts.records[0]?.packetKind).toBe("erasure");
  });

  test("constructOptIr preserves dependent imported facts and drops orphan proof-only lineage", () => {
    const result = constructOptIr(validConstructOptIrInputWithProofOnlyDependentFactsForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to preserve dependent proof-only facts.");
    }

    expect(result.facts.records.map((record) => record.packetKind)).toEqual(["erasure", "erasure"]);
    const dependentRecord = result.facts.records[1];
    if (dependentRecord === undefined) {
      throw new Error("Expected dependent erasure fact to survive construction.");
    }
    expect(dependentRecord.lineage).toEqual({
      kind: "proofErasurePreserved",
      sourceFactId: dependentRecord.factId,
      erasedProofMirValueIds: [proofMirValueId(9451)],
    });
  });

  test("constructOptIr preserves noalias on surviving edges when proof-only witness erasure has lineage", () => {
    const input = validConstructOptIrInputWithPreservedNoaliasWitnessForTest();
    const result = constructOptIr(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to preserve noalias facts with witness lineage.");
    }

    const firstFunction = input.handoff.checkedMir.mir.functions.entries()[0];
    if (firstFunction === undefined) {
      throw new Error("Expected checked MIR function for noalias witness fixture.");
    }
    const edgeId = firstFunction.edges.entries()[0]?.edgeId ?? proofMirControlEdgeId(0);
    const noaliasRecord = result.facts.records.find((record) => record.packetKind === "noalias");
    if (noaliasRecord === undefined) {
      throw new Error("Expected preserved noalias fact in construction output.");
    }
    expect(noaliasRecord.lineage).toEqual({
      kind: "proofErasurePreserved",
      sourceFactId: noaliasRecord.factId,
      erasedProofMirValueIds: [proofMirValueId(9451)],
    });

    const factQuery = createOptIrFactQuery(result.facts);
    expect(
      factQuery.mustNotAlias({
        kind: "edge",
        functionInstanceId: firstFunction.functionInstanceId,
        edgeId,
      }),
    ).toEqual({
      kind: "yes",
      factsUsed: [noaliasRecord.factId],
      explanation: [
        `Fact ${Number(noaliasRecord.factId)} proves noalias for edge:${String(firstFunction.functionInstanceId)}:${String(edgeId)}.`,
      ],
    });
  });

  test("constructOptIr drops noalias justified only through erased proof-only witnesses without lineage", () => {
    const input = validConstructOptIrInputWithOrphanNoaliasWitnessForTest();
    const result = constructOptIr(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to drop orphan noalias witness facts.");
    }

    expect(result.facts.records.some((record) => record.packetKind === "noalias")).toBe(false);

    const firstFunction = input.handoff.checkedMir.mir.functions.entries()[0];
    if (firstFunction === undefined) {
      throw new Error("Expected checked MIR function for orphan noalias fixture.");
    }
    const edgeId = firstFunction.edges.entries()[0]?.edgeId ?? proofMirControlEdgeId(0);
    expect(
      createOptIrFactQuery(result.facts).mustNotAlias({
        kind: "edge",
        functionInstanceId: firstFunction.functionInstanceId,
        edgeId,
      }).kind,
    ).toBe("unknown");
  });

  test("constructOptIr materializes backed validated-payload regions for checked buffer reads", () => {
    const result = constructOptIr(validConstructOptIrInputWithValidatedBufferReadForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected validated-buffer read construction to succeed.");
    }

    const memoryLoad = result.program.operations?.find(
      (operation) => operation.kind === "memoryLoad",
    );
    expect(memoryLoad?.kind).toBe("memoryLoad");
    if (memoryLoad?.kind !== "memoryLoad") {
      throw new Error("Expected validated-buffer read to lower to a memory load.");
    }
    expect(memoryLoad.memoryAccess.boundsAuthority.kind).toBe("certifiedFact");
    const monoInstanceKey = String(result.program.functions.entries()[0]?.monoInstanceId);
    expect(memoryLoad.memoryAccess.layoutPath).toBe(layoutFactKey(monoInstanceKey));
    expect(memoryLoad.memoryAccess.validatedBuffer).toEqual({
      fieldName: "9501",
      layoutPath: [monoInstanceKey, "9501"],
      readRequires: ["9501"],
      pathCertificates: [optIrPathCertificateId(9501)],
    });
    expect(result.program.regions.entries()).toHaveLength(2);
    expect(result.program.optimizationRegions?.map((region) => region.kind)).toEqual([
      "packetSource",
      "validatedPayload",
    ]);
    const packetSourceRegion = result.program.optimizationRegions?.find(
      (region) => region.kind === "packetSource",
    );
    const payloadRegion = result.program.optimizationRegions?.find(
      (region) => region.kind === "validatedPayload",
    );
    if (packetSourceRegion === undefined || payloadRegion === undefined) {
      throw new Error("Expected packet source and payload regions.");
    }
    const regionMemoryFact = result.facts.records.find(
      (record) =>
        record.extensionKey === "memory-order" &&
        record.extensionPacketKind === "region-memory-type" &&
        record.subjectKey === `region:${String(payloadRegion.regionId)}`,
    );
    expect(regionMemoryFact?.extensionPayload).toMatchObject({
      memoryType: "validatedPayload",
      backingRegion: packetSourceRegion.regionId,
      certifiedOffset: 0n,
    });
  });

  test("constructOptIr fails closed when a validated-buffer read has no imported bounds fact", () => {
    const result = constructOptIr(constructOptIrInputWithMissingValidatedBufferAuthorityForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected missing validated-buffer authority to fail construction.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "statement:9501:missing-validated-buffer-authority:fn:0|ownerType:none|owner:<>|fn:<>",
    );
  });

  test("constructOptIr lowers entry parameter place loads as entry block parameters", () => {
    const result = constructOptIr(validConstructOptIrInputWithEntryParameterLoadForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected entry parameter load construction to succeed.");
    }

    const function_ = result.program.functions.entries()[0];
    if (function_ === undefined) {
      throw new Error("Expected constructed function.");
    }
    const entryBlock = function_.blocks.find((block) => block.blockId === function_.entryBlock);
    if (entryBlock === undefined) {
      throw new Error("Expected constructed entry block.");
    }

    expect(entryBlock.parameters.map((parameter) => parameter.incomingRole)).toEqual(["entry"]);
    expect(entryBlock.operations).toEqual([]);
  });

  test("buildOptimizedOptIr propagates construction errors without optimizer execution", () => {
    let optimizerCalled = false;
    const result = buildOptimizedOptIr(
      {
        ...invalidBoundaryConstructOptIrInputForTest(),
        policy: productionOptimizationPolicyForTest(),
      },
      {
        optimizer() {
          optimizerCalled = true;
          throw new Error("optimizer should not run after construction failure");
        },
      },
    );

    expect(result.kind).toBe("error");
    expect(optimizerCalled).toBe(false);
  });

  test("OptIR is exported as a top-level namespace and direct barrel", () => {
    expect(Object.keys(topLevelExports)).toContain("optIr");
    expect(Object.keys(topLevelExports)).toContain("constructOptIr");
    expect(Object.keys(optIrBarrel)).toEqual(
      expect.arrayContaining(["constructOptIr", "buildOptimizedOptIr", "optimizeOptIr"]),
    );
  });
});
