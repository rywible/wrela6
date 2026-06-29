import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import { emptyCheckedFactPacket } from "../../../src/proof-check/model/fact-packet";
import {
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirPlaceId,
  proofMirPrivateStateGenerationId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import {
  importCheckedFactPacketIntoOptIrFactSet,
  type OptIrFactSetImportResult,
} from "../../../src/opt-ir/facts/fact-index";
import { createOptIrFactQuery } from "../../../src/opt-ir/facts/fact-query";
import { optIrFactId } from "../../../src/opt-ir/ids";
import { checkedFactPacketEntryForTest } from "../../support/opt-ir/fact-import-fixtures";
import { completeFactImportValidationInputForTest } from "../../support/opt-ir/fact-import-fixtures";

function expectFactSet(result: OptIrFactSetImportResult) {
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    throw new Error("Expected fact set import to succeed.");
  }
  return result.factSet;
}

describe("OptIR fact set", () => {
  test("fact set imports checked packet facts into stable authoritative records and indexes", () => {
    const ownership = checkedFactPacketEntryForTest({ kind: "ownership", ordinal: 0 });
    const validatedBuffer = checkedFactPacketEntryForTest({
      kind: "validatedBuffer",
      ordinal: 1,
      subject: { kind: "value", valueId: proofMirValueId(2) },
      dependencies: [
        { kind: "proofMirEdge", edgeId: proofMirControlEdgeId(1) },
        ...checkedFactPacketEntryForTest({ kind: "validatedBuffer" }).dependencies.filter(
          (dependency) => dependency.kind !== "proofMirEdge",
        ),
      ],
    });
    const baseInput = completeFactImportValidationInputForTest({
      kind: "ownership",
      entry: ownership,
    });

    const factSet = expectFactSet(
      importCheckedFactPacketIntoOptIrFactSet({
        handoff: baseInput.handoff,
        packet: {
          ...emptyCheckedFactPacket(),
          ownership: [ownership],
          validatedBuffers: [validatedBuffer],
        },
        proofMirLookups: baseInput.proofMirLookups,
        layoutFacts: baseInput.layoutFacts,
      }),
    );

    expect(factSet.records.map((record) => Number(record.factId))).toEqual([0, 1]);
    expect(factSet.records.map((record) => record.packetKind)).toEqual([
      "ownership",
      "validatedBuffer",
    ]);
    const firstRecord = factSet.records[0];
    const secondRecord = factSet.records[1];
    if (firstRecord === undefined || secondRecord === undefined) {
      throw new Error("Expected two imported fact records.");
    }

    expect(firstRecord).toMatchObject({
      packetFactId: ownership.factId,
      subject: ownership.subject,
      scope: ownership.scope,
      certificate: ownership.certificate,
      dependencies: ownership.dependencies,
      invalidations: ownership.invalidatedBy,
      origin: ownership.origin,
      typedAnswers: ["owns"],
      explanation: {
        answerKinds: ["owns"],
        dependencyKinds: ["proofMirPlace", "proofMirValue", "coreCertificate"],
      },
      lineage: {
        kind: "checkedPacket",
        packetKind: "ownership",
        packetFactId: ownership.factId,
      },
    });
    expect(secondRecord.typedAnswers).toEqual(["provesInBounds", "provesImpossible"]);
    expect(Object.isFrozen(factSet)).toBe(true);
    expect(Object.isFrozen(factSet.records)).toBe(true);
    expect(Object.isFrozen(firstRecord.dependencies)).toBe(true);
    expect(Object.isFrozen(factSet.indexes.byTypedAnswer.provesInBounds)).toBe(true);
    expect(factSet.indexes.byPacketKind.ownership?.map(Number)).toEqual([0]);
    expect(factSet.indexes.byPacketKind.validatedBuffer?.map(Number)).toEqual([1]);
    expect(factSet.indexes.bySubjectKey["value:2"]?.map(Number)).toEqual([1]);
    expect(factSet.indexes.byTypedAnswer.provesInBounds?.map(Number)).toEqual([1]);
    expect(factSet.indexes.byDependencyKind.proofMirEdge?.map(Number)).toEqual([1]);
    expect(Number(factSet.indexes.byPacketFactId[String(ownership.factId)])).toBe(0);
  });

  test("fact set import fails closed with stable OptIR diagnostics for invalid entries", () => {
    const valid = checkedFactPacketEntryForTest({ kind: "ownership", ordinal: 0 });
    const invalidOwnership = checkedFactPacketEntryForTest({
      kind: "ownership",
      ordinal: 1,
      dependencies: [],
    });
    const invalidValidatedBuffer = checkedFactPacketEntryForTest({
      kind: "validatedBuffer",
      ordinal: 2,
      dependencies: [],
    });
    const baseInput = completeFactImportValidationInputForTest({ kind: "ownership", entry: valid });

    const result = importCheckedFactPacketIntoOptIrFactSet({
      handoff: baseInput.handoff,
      packet: {
        ...emptyCheckedFactPacket(),
        ownership: [valid, invalidOwnership],
        validatedBuffers: [invalidValidatedBuffer],
      },
      proofMirLookups: baseInput.proofMirLookups,
      layoutFacts: baseInput.layoutFacts,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected fact set import to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "ownership:2:OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY:ownership:coreCertificate",
      "ownership:2:OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY:ownership:proofMirPlace",
      "ownership:2:OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY:ownership:proofMirValue",
      "validatedBuffer:3:OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY:validatedBuffer:coreCertificate",
      "validatedBuffer:3:OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY:validatedBuffer:layoutFact",
      "validatedBuffer:3:OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY:validatedBuffer:proofMirEdge",
    ]);
    const orderKeys = result.diagnostics.map((diagnostic) => diagnostic.orderKey);
    expect(orderKeys).toEqual(orderKeys.slice().sort());
  });

  test("fact set import rejects duplicate packet fact ids before building indexes", () => {
    const ownership = checkedFactPacketEntryForTest({ kind: "ownership", ordinal: 0 });
    const duplicateNoalias = checkedFactPacketEntryForTest({ kind: "noalias", ordinal: 0 });
    const baseInput = completeFactImportValidationInputForTest({
      kind: "ownership",
      entry: ownership,
    });

    const result = importCheckedFactPacketIntoOptIrFactSet({
      handoff: baseInput.handoff,
      packet: {
        ...emptyCheckedFactPacket(),
        ownership: [ownership],
        noalias: [duplicateNoalias],
      },
      proofMirLookups: baseInput.proofMirLookups,
      layoutFacts: baseInput.layoutFacts,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected duplicate packet fact id import to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "noalias:1:OPT_IR_FACT_IMPORT_DUPLICATE_PACKET_FACT_ID:duplicatePacketFactId:1",
    ]);
  });

  test("layout and bounds queries answer from imported fact indexes with stable facts used", () => {
    const layoutKey = layoutFactKey("layout:fixture");
    const validatedBuffer = checkedFactPacketEntryForTest({
      kind: "validatedBuffer",
      ordinal: 0,
      subject: { kind: "value", valueId: proofMirValueId(1) },
    });
    const layoutAbi = checkedFactPacketEntryForTest({
      kind: "layoutAbi",
      ordinal: 1,
      subject: { kind: "layout", layoutKey },
    });
    const baseInput = completeFactImportValidationInputForTest({
      kind: "validatedBuffer",
      entry: validatedBuffer,
    });

    const factSet = expectFactSet(
      importCheckedFactPacketIntoOptIrFactSet({
        handoff: baseInput.handoff,
        packet: {
          ...emptyCheckedFactPacket(),
          validatedBuffers: [validatedBuffer],
          layoutAbi: [layoutAbi],
        },
        proofMirLookups: baseInput.proofMirLookups,
        layoutFacts: baseInput.layoutFacts,
      }),
    );
    const factQuery = createOptIrFactQuery(factSet);

    expect(factQuery.provesInBounds({ kind: "value", valueId: proofMirValueId(1) })).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(0)],
      explanation: ["Fact 0 proves validated buffer bounds for value:1."],
    });
    expect(factQuery.layoutOf(layoutKey)).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(1)],
      explanation: ["Fact 1 proves layout ABI for layout:layout:fixture."],
    });
    expect(
      factQuery.endianOfLayoutAccess({
        access: { kind: "validatedBufferBounds", layoutKey },
        layoutProgram: { target: { endian: "little" } },
      }),
    ).toEqual({
      kind: "yes",
      value: "little",
      factsUsed: [optIrFactId(1)],
      explanation: [
        "Fact 1 proves layout ABI for layout:layout:fixture.",
        "Endian little was read from the selected layout program target facts.",
      ],
    });
    expect(factQuery.abiShape(layoutKey)).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(1)],
      explanation: ["Fact 1 proves ABI shape for layout:layout:fixture."],
    });

    const layoutOnlyFactQuery = createOptIrFactQuery({
      ...factSet,
      indexes: {
        ...factSet.indexes,
        byTypedAnswer: { layoutOf: [optIrFactId(1)] },
      },
    });
    expect(layoutOnlyFactQuery.layoutOf(layoutKey).kind).toBe("yes");
    expect(
      layoutOnlyFactQuery.endianOfLayoutAccess({
        access: { kind: "validatedBufferBounds", layoutKey },
        layoutProgram: { target: { endian: "little" } },
      }),
    ).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No layout ABI fact is in scope for layout:layout:fixture."],
    });
    expect(layoutOnlyFactQuery.abiShape(layoutKey)).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No ABI shape fact is in scope for layout:layout:fixture."],
    });

    expect(factQuery.provesInBounds({ kind: "value", valueId: proofMirValueId(2) })).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No in-bounds fact is in scope for value:2."],
    });
  });

  test("alias and ownership queries answer from imported fact indexes with stable facts used", () => {
    const ownership = checkedFactPacketEntryForTest({
      kind: "ownership",
      ordinal: 0,
      subject: { kind: "place", placeId: proofMirPlaceId(1) },
    });
    const noalias = checkedFactPacketEntryForTest({
      kind: "noalias",
      ordinal: 1,
      subject: {
        kind: "edge",
        functionInstanceId: monoInstanceId("fixture::main"),
        edgeId: proofMirControlEdgeId(1),
      },
    });
    const fieldDisjointness = checkedFactPacketEntryForTest({
      kind: "fieldDisjointness",
      ordinal: 2,
      subject: { kind: "place", placeId: proofMirPlaceId(2) },
    });
    const baseInput = completeFactImportValidationInputForTest({
      kind: "ownership",
      entry: ownership,
    });

    const factSet = expectFactSet(
      importCheckedFactPacketIntoOptIrFactSet({
        handoff: baseInput.handoff,
        packet: {
          ...emptyCheckedFactPacket(),
          ownership: [ownership],
          noalias: [noalias],
          fieldDisjointness: [fieldDisjointness],
        },
        proofMirLookups: baseInput.proofMirLookups,
        layoutFacts: baseInput.layoutFacts,
      }),
    );
    const factQuery = createOptIrFactQuery(factSet);

    expect(factQuery.owns({ kind: "place", placeId: proofMirPlaceId(1) })).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(0)],
      explanation: ["Fact 0 proves ownership for place:1."],
    });
    expect(
      factQuery.mustNotAlias({
        kind: "edge",
        functionInstanceId: monoInstanceId("fixture::main"),
        edgeId: proofMirControlEdgeId(1),
      }),
    ).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(1)],
      explanation: ["Fact 1 proves noalias for edge:fixture::main:1."],
    });
    expect(factQuery.fieldsDisjoint({ kind: "place", placeId: proofMirPlaceId(2) })).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(2)],
      explanation: ["Fact 2 proves field disjointness for place:2."],
    });

    expect(factQuery.owns({ kind: "value", valueId: proofMirValueId(2) })).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No ownership fact is in scope for value:2."],
    });
    expect(factQuery.mustNotAlias({ kind: "value", valueId: proofMirValueId(1) })).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No noalias fact is in scope for value:1."],
    });
    expect(factQuery.fieldsDisjoint({ kind: "place", placeId: proofMirPlaceId(1) })).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No field disjointness fact is in scope for place:1."],
    });
  });

  test("effect and erasure queries answer from imported fact indexes with stable facts used", () => {
    const platformEffect = checkedFactPacketEntryForTest({
      kind: "platformEffect",
      ordinal: 0,
    });
    const terminalClosure = checkedFactPacketEntryForTest({
      kind: "terminalClosure",
      ordinal: 1,
    });
    const capabilityFlow = checkedFactPacketEntryForTest({
      kind: "capabilityFlow",
      ordinal: 2,
    });
    const privateState = checkedFactPacketEntryForTest({
      kind: "privateState",
      ordinal: 3,
    });
    const erasure = checkedFactPacketEntryForTest({
      kind: "erasure",
      ordinal: 4,
      subject: { kind: "value", valueId: proofMirValueId(2) },
      dependencies: [
        { kind: "proofMirValue", valueId: proofMirValueId(2) },
        ...checkedFactPacketEntryForTest({ kind: "erasure" }).dependencies.filter(
          (dependency) => dependency.kind !== "proofMirPlace",
        ),
      ],
    });
    const validatedBuffer = checkedFactPacketEntryForTest({
      kind: "validatedBuffer",
      ordinal: 5,
      subject: { kind: "value", valueId: proofMirValueId(1) },
    });
    const baseInput = completeFactImportValidationInputForTest({
      kind: "platformEffect",
      entry: platformEffect,
    });

    const factSet = expectFactSet(
      importCheckedFactPacketIntoOptIrFactSet({
        handoff: baseInput.handoff,
        packet: {
          ...emptyCheckedFactPacket(),
          platformEffects: [platformEffect],
          terminalClosure: [terminalClosure],
          capabilityFlow: [capabilityFlow],
          privateState: [privateState],
          erasures: [erasure],
          validatedBuffers: [validatedBuffer],
        },
        proofMirLookups: baseInput.proofMirLookups,
        layoutFacts: baseInput.layoutFacts,
      }),
    );
    const factQuery = createOptIrFactQuery(factSet);
    if (platformEffect.subject.kind !== "authority") {
      throw new Error("Expected platform effect fixture to use an authority subject.");
    }
    if (privateState.subject.kind !== "privateState") {
      throw new Error("Expected private-state fixture to use a private-state subject.");
    }

    expect(factQuery.callEffects(platformEffect.subject)).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(3)],
      explanation: [
        "Fact 3 proves call effects for authority:0101010101010101010101010101010101010101010101010101010101010101:platform:get_memory_map.",
      ],
    });
    expect(factQuery.volatilityOf(platformEffect.subject)).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(3)],
      explanation: [
        "Fact 3 proves volatility for authority:0101010101010101010101010101010101010101010101010101010101010101:platform:get_memory_map.",
      ],
    });
    expect(
      factQuery.terminalBehavior({
        kind: "terminal",
        terminalKey: checkedTerminalClosureKey("terminal:fixture"),
      }),
    ).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(5)],
      explanation: ["Fact 5 proves terminal behavior for terminal:terminal:fixture."],
    });
    expect(
      factQuery.capabilityFlow({
        kind: "call",
        functionInstanceId: monoInstanceId("fixture::main"),
        callId: proofMirCallId(1),
      }),
    ).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(4)],
      explanation: ["Fact 4 proves capability flow for call:fixture::main:1."],
    });
    expect(factQuery.privateStateGeneration(privateState.subject)).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(2)],
      explanation: ["Fact 2 proves private-state generation for privateState:1:1."],
    });
    expect(factQuery.erasureOf({ kind: "value", valueId: proofMirValueId(2) })).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(0)],
      explanation: ["Fact 0 proves erasure for value:2."],
    });
    expect(factQuery.provesImpossible({ kind: "value", valueId: proofMirValueId(1) })).toEqual({
      kind: "yes",
      factsUsed: [optIrFactId(1)],
      explanation: ["Fact 1 proves impossibility for value:1."],
    });

    expect(
      factQuery.privateStateGeneration({
        kind: "privateState",
        placeId: proofMirPlaceId(1),
        generation: proofMirPrivateStateGenerationId(2),
      }),
    ).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No private-state generation fact is in scope for privateState:1:2."],
    });
    expect(factQuery.erasureOf({ kind: "value", valueId: proofMirValueId(1) })).toEqual({
      kind: "unknown",
      factsUsed: [],
      explanation: ["No erasure fact is in scope for value:1."],
    });
  });
});
