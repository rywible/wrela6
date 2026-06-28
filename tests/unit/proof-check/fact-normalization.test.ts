import { describe, expect, test } from "bun:test";
import type { BrandId } from "../../../src/hir/ids";
import type { MonoInstantiatedProofId } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { coreTypeId, functionId } from "../../../src/semantic/ids";
import {
  matchCaseKey,
  normalizeProofCheckTerm,
  platformEffectKindId,
  proofCheckPlaceBinderKey,
  runtimeEffectKindId,
  validateProofCheckOperandTerm,
  validateProofCheckRequirementTerm,
  type ProofCheckFactTerm,
  type ProofCheckRequirementTerm,
  type ProofCheckTypeFactInvalidation,
} from "../../../src/proof-check/model/fact-language";
import {
  proofCheckBinderSubstitutionForTest,
  substituteProofCheckBrandBinder,
  substituteProofCheckOperand,
  substituteProofCheckPlaceBinder,
  substituteProofCheckTerm,
  substituteProofCheckValueBinder,
} from "../../../src/proof-check/model/fact-environment";
import {
  proofMirCallId,
  proofMirLayoutTermId,
  proofMirPlaceId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type { ProofMirLayoutTermReference } from "../../../src/proof-mir/model/layout-bindings";
import {
  capabilityRequirementForTest,
  comparisonTerm,
  literalInt,
  proofCheckValueOperandForTest,
  valueTerm,
} from "../../support/proof-check/term-fixtures";

const u8Width = { kind: "core", coreTypeId: coreTypeId("u8") } as const;

function brandIdForTest(value: number): MonoInstantiatedProofId<BrandId> {
  const instanceId = monoInstanceId("test");
  return {
    owner: { kind: "image", instanceId },
    hirId: value as BrandId,
    instanceId,
  };
}

function layoutTermForTest(termId: number): ProofMirLayoutTermReference {
  return {
    termId: proofMirLayoutTermId(termId),
    unit: "byteLength",
    path: {
      root: {
        kind: "validatedBufferSourceLength",
        instanceId: monoInstanceId("0"),
      },
      childPath: [],
    },
  };
}

describe("proof-check term language", () => {
  test("normalization sorts equality operands but preserves less-than order", () => {
    const left = proofCheckValueOperandForTest("value:b");
    const right = proofCheckValueOperandForTest("value:a");

    expect(normalizeProofCheckTerm(comparisonTerm(left, "eq", right)).key).toContain(
      "value:a==value:b",
    );
    expect(normalizeProofCheckTerm(comparisonTerm(left, "lt", right)).key).toContain(
      "value:b<value:a",
    );
  });

  test("not-equal comparisons sort commutative operands by stable key", () => {
    const left = proofCheckValueOperandForTest("value:z");
    const right = proofCheckValueOperandForTest("value:m");

    expect(normalizeProofCheckTerm(comparisonTerm(left, "ne", right)).key).toContain(
      "value:m!=value:z",
    );
  });

  test("terminalCall and matchRefinement are rejected in requirement position", () => {
    const matchRefinement: ProofCheckFactTerm = {
      kind: "matchRefinement",
      scrutinee: valueTerm("scrutinee"),
      caseKey: matchCaseKey("case:a"),
      polarity: "matched",
    };
    const terminalCall: ProofCheckFactTerm = {
      kind: "terminalCall",
      call: proofMirCallId(1),
      terminalKind: "platformExit",
    };

    expect(
      validateProofCheckRequirementTerm(matchRefinement, "sourceRequirement").map(
        (issue) => issue.kind,
      ),
    ).toEqual(["illegalRequirementKind"]);
    expect(
      validateProofCheckRequirementTerm(terminalCall, "callRequirement").map((issue) => issue.kind),
    ).toEqual(["illegalRequirementKind"]);
  });

  test("preState and postState are rejected outside catalog and summary contexts", () => {
    const preStateOperand = {
      kind: "preState" as const,
      operand: valueTerm("capacity"),
    };
    const postStateOperand = {
      kind: "postState" as const,
      operand: valueTerm("capacity"),
    };

    expect(
      validateProofCheckOperandTerm(preStateOperand, "sourceRequirement").map(
        (issue) => issue.kind,
      ),
    ).toEqual(["illegalStateOperand"]);
    expect(
      validateProofCheckOperandTerm(postStateOperand, "callRequirement").map((issue) => issue.kind),
    ).toEqual(["illegalStateOperand"]);
    expect(validateProofCheckOperandTerm(preStateOperand, "catalogPostcondition")).toEqual([]);
    expect(validateProofCheckOperandTerm(postStateOperand, "runtimePostcondition")).toEqual([]);
    expect(validateProofCheckOperandTerm(preStateOperand, "summaryInstantiation")).toEqual([]);
  });

  test("nested preState and postState operands are rejected", () => {
    const nested = {
      kind: "preState" as const,
      operand: {
        kind: "postState" as const,
        operand: valueTerm("capacity"),
      },
    };

    expect(
      validateProofCheckOperandTerm(nested, "catalogPostcondition").map((issue) => issue.kind),
    ).toEqual(["nestedStateOperand"]);
  });

  test("binder substitution resolves receiver, parameter, argument, result, and synthetic binders", () => {
    const substitution = proofCheckBinderSubstitutionForTest({
      receiver: proofMirPlaceId(10),
      parameters: { 0: proofMirPlaceId(11) },
      arguments: { 1: proofMirPlaceId(12) },
      result: proofMirPlaceId(13),
      syntheticPlaces: { "packet:src": proofMirPlaceId(14) },
      syntheticValues: { "value:tmp": proofMirValueId(15) },
    });

    expect(substituteProofCheckPlaceBinder({ kind: "receiver" }, substitution)).toEqual({
      kind: "proofMirPlace",
      placeId: proofMirPlaceId(10),
    });
    expect(substituteProofCheckPlaceBinder({ kind: "parameter", index: 0 }, substitution)).toEqual({
      kind: "proofMirPlace",
      placeId: proofMirPlaceId(11),
    });
    expect(substituteProofCheckPlaceBinder({ kind: "argument", index: 1 }, substitution)).toEqual({
      kind: "proofMirPlace",
      placeId: proofMirPlaceId(12),
    });
    expect(substituteProofCheckPlaceBinder({ kind: "result" }, substitution)).toEqual({
      kind: "proofMirPlace",
      placeId: proofMirPlaceId(13),
    });
    expect(
      substituteProofCheckValueBinder(
        { kind: "synthetic", id: "value:tmp" as never },
        substitution,
      ),
    ).toEqual({
      kind: "proofMirValue",
      valueId: proofMirValueId(15),
    });
  });

  test("binder substitution resolves source brand, layout term, and Proof MIR binders without capture", () => {
    const resolvedLayoutTerm = layoutTermForTest(99);
    const substitution = proofCheckBinderSubstitutionForTest({
      receiver: proofMirPlaceId(20),
      proofMirPlaces: { 7: proofMirPlaceId(21) },
      proofMirValues: { 3: proofMirValueId(22) },
      sourceBrands: {
        "proofMirPlace:20": brandIdForTest(42),
      },
      layoutTerms: {
        5: resolvedLayoutTerm,
      },
    });

    expect(
      substituteProofCheckBrandBinder(
        { kind: "sourceBrand", place: { kind: "receiver" } },
        substitution,
      ),
    ).toEqual({
      kind: "proofBrand",
      brandId: brandIdForTest(42),
    });

    expect(
      substituteProofCheckOperand(
        {
          kind: "layoutTerm",
          term: layoutTermForTest(5),
        },
        substitution,
      ),
    ).toEqual({
      kind: "layoutTerm",
      term: resolvedLayoutTerm,
    });

    const substituted = substituteProofCheckTerm(
      comparisonTerm(
        {
          kind: "place",
          place: { kind: "proofMirPlace", placeId: proofMirPlaceId(7) },
          projection: [],
        },
        "eq",
        {
          kind: "value",
          value: { kind: "proofMirValue", valueId: proofMirValueId(3) },
        },
      ),
      substitution,
    );

    expect(substituted.term).toEqual(
      comparisonTerm(
        {
          kind: "place",
          place: { kind: "proofMirPlace", placeId: proofMirPlaceId(21) },
          projection: [],
        },
        "eq",
        {
          kind: "value",
          value: { kind: "proofMirValue", valueId: proofMirValueId(22) },
        },
      ),
    );
    expect(substituted.key).toContain("proofMirPlace:21==proofMirValue:22");
  });

  test("unmapped binders remain stable under substitution", () => {
    const substitution = proofCheckBinderSubstitutionForTest({
      receiver: proofMirPlaceId(1),
    });
    const subjectBinder = { kind: "subject" as const };

    expect(substituteProofCheckPlaceBinder(subjectBinder, substitution)).toBe(subjectBinder);
    expect(proofCheckPlaceBinderKey(subjectBinder)).toBe("subject");
  });

  test("requirement term fixtures cover the closed requirement language", () => {
    const requirementTerms: ProofCheckRequirementTerm[] = [
      comparisonTerm(valueTerm("a"), "eq", valueTerm("b")),
      {
        kind: "predicate",
        predicateFunctionId: functionId(1),
        arguments: [valueTerm("arg")],
      },
      {
        kind: "layoutFits",
        source: { kind: "receiver" },
        end: literalInt(8n),
      },
      {
        kind: "payloadEnd",
        source: { kind: "argument", index: 0 },
        end: literalInt(16n),
      },
      {
        kind: "fieldAvailable",
        source: { kind: "subject" },
        fieldId: 3 as never,
      },
      {
        kind: "rangeConstraint",
        left: valueTerm("left"),
        relation: "<=",
        right: valueTerm("right"),
        width: u8Width,
      },
      {
        kind: "noUnsignedOverflow",
        expression: valueTerm("expr"),
        width: u8Width,
      },
      capabilityRequirementForTest("capability:tx"),
      {
        kind: "packetSource",
        packet: { kind: "result" },
        source: { kind: "parameter", index: 0 },
      },
    ];

    for (const term of requirementTerms) {
      expect(normalizeProofCheckTerm(term).key.length).toBeGreaterThan(0);
    }
  });

  test("fact term language includes matchRefinement and terminalCall beyond requirements", () => {
    const factTerms: ProofCheckFactTerm[] = [
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
      {
        kind: "matchRefinement",
        scrutinee: valueTerm("scrutinee"),
        caseKey: matchCaseKey("case:b"),
        polarity: "excluded",
      },
      {
        kind: "terminalCall",
        call: proofMirCallId(2),
        terminalKind: "doesNotReturn",
      },
    ];

    for (const term of factTerms) {
      expect(normalizeProofCheckTerm(term).key.length).toBeGreaterThan(0);
    }
  });

  test("type fact invalidation kinds are closed", () => {
    const invalidations: ProofCheckTypeFactInvalidation[] = [
      { kind: "moveTransfers" },
      { kind: "consumeRemoves" },
      { kind: "privateStateAdvance", place: { kind: "receiver" } },
      { kind: "platformEffect", effectKind: platformEffectKindId("send") },
      { kind: "runtimeEffect", effectKind: runtimeEffectKindId("alloc") },
      { kind: "validationSplit" },
      { kind: "attemptSplit" },
    ];

    expect(invalidations.map((invalidation) => invalidation.kind)).toEqual([
      "moveTransfers",
      "consumeRemoves",
      "privateStateAdvance",
      "platformEffect",
      "runtimeEffect",
      "validationSplit",
      "attemptSplit",
    ]);
  });
});
