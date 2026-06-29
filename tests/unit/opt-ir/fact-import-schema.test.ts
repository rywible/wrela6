import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import {
  checkedFactKindId,
  CHECKED_PACKET_FACT_KINDS,
} from "../../../src/proof-check/model/fact-packet";
import {
  checkedSummaryInstantiationCertificateId,
  proofCheckCoreCertificateId,
} from "../../../src/proof-check/ids";
import { proofMirCallId, proofMirPlaceId, proofMirValueId } from "../../../src/proof-mir/ids";
import {
  checkedFactImportSchemaForKind,
  type CheckedFactImportValidationResult,
  validateCheckedFactImportSchema,
} from "../../../src/opt-ir/facts/fact-import-schema";
import {
  checkedFactPacketEntryForTest,
  completeFactImportValidationInputForTest,
  missingPathScopeForFactImportTest,
  semanticsCertificateForFactImportTest,
  validateCheckedFactImportSchemaForTest,
  wrongCoreCertificateForFactImportTest,
  wrongSubjectForFactImportTest,
} from "../../support/opt-ir/fact-import-fixtures";

const EXPECTED_TYPED_ANSWERS = {
  ownership: ["owns"],
  noalias: ["mustNotAlias"],
  fieldDisjointness: ["fieldsDisjoint"],
  erasure: ["erasureOf"],
  validatedBuffer: ["provesInBounds", "provesImpossible"],
  packetSource: ["provesInBounds"],
  privateState: ["privateStateGeneration"],
  platformEffect: ["callEffects", "volatilityOf"],
  capabilityFlow: ["capabilityFlow"],
  terminalClosure: ["terminalBehavior", "provesImpossible"],
  exitClosure: ["terminalBehavior", "provesImpossible"],
  layoutAbi: ["layoutOf", "endianOfLayoutAccess", "abiShape"],
  origin: ["provenanceContributor"],
} as const;

function expectImportError(result: CheckedFactImportValidationResult): readonly string[] {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") {
    throw new Error("Expected checked fact import validation to fail.");
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("OptIR checked fact import schema registry", () => {
  test("exposes a closed schema for every checked packet fact kind", () => {
    expect(
      CHECKED_PACKET_FACT_KINDS.map(
        (kind) => checkedFactImportSchemaForKind(checkedFactKindId(kind)).kind,
      ),
    ).toEqual([...CHECKED_PACKET_FACT_KINDS]);
  });

  for (const kind of CHECKED_PACKET_FACT_KINDS) {
    test(`${kind} import emits exact typed answers`, () => {
      const schema = checkedFactImportSchemaForKind(checkedFactKindId(kind));
      expect(schema.typedAnswers).toEqual(EXPECTED_TYPED_ANSWERS[kind]);
    });

    test(`${kind} import accepts the complete contract envelope`, () => {
      const result = validateCheckedFactImportSchema(
        completeFactImportValidationInputForTest({ kind }),
      );
      expect(result).toEqual({ kind: "ok", typedAnswers: EXPECTED_TYPED_ANSWERS[kind] });
    });

    test(`${kind} import rejects wrong subject shape`, () => {
      const result = validateCheckedFactImportSchemaForTest({
        entry: checkedFactPacketEntryForTest({
          kind,
          subject: wrongSubjectForFactImportTest(kind),
        }),
      });
      expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_WRONG_SUBJECT");
    });

    test(`${kind} import rejects missing required dependency`, () => {
      const result = validateCheckedFactImportSchemaForTest({
        entry: checkedFactPacketEntryForTest({ kind, dependencies: [] }),
      });
      expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY");
    });

    test(`${kind} import rejects mismatched certificate or authority`, () => {
      const result = validateCheckedFactImportSchemaForTest({
        entry: checkedFactPacketEntryForTest({
          kind,
          certificate:
            kind === "terminalClosure"
              ? wrongCoreCertificateForFactImportTest
              : semanticsCertificateForFactImportTest,
        }),
      });
      expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_CERTIFICATE_MISMATCH");
    });
  }

  test("validatedBuffer schema requires path certificate dependency for path scope", () => {
    const result = validateCheckedFactImportSchemaForTest({
      entry: checkedFactPacketEntryForTest({
        kind: "validatedBuffer",
        scope: missingPathScopeForFactImportTest,
        dependencies: [],
      }),
    });

    expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY");
  });

  test("noalias schema rejects partial envelopes instead of weakening to a yes-answer", () => {
    const result = validateCheckedFactImportSchemaForTest({
      entry: checkedFactPacketEntryForTest({
        kind: "noalias",
        subject: { kind: "value", valueId: proofMirValueId(2) },
        dependencies: [{ kind: "proofMirValue", valueId: proofMirValueId(2) }],
      }),
    });

    expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY");
  });

  test("packetSource import rejects stale path scope", () => {
    const result = validateCheckedFactImportSchemaForTest({
      entry: checkedFactPacketEntryForTest({
        kind: "packetSource",
        scope: missingPathScopeForFactImportTest,
      }),
    });
    expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_STALE_SCOPE");
  });

  test("ownership import rejects missing Proof MIR lookup", () => {
    const input = completeFactImportValidationInputForTest({ kind: "ownership" });
    const result = validateCheckedFactImportSchema({
      ...input,
      proofMirLookups: { ...input.proofMirLookups, places: [proofMirPlaceId(999)] },
    });
    expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_MISSING_PROOF_MIR_NODE");
  });

  test("layoutAbi import rejects mismatched layout fingerprint", () => {
    const input = completeFactImportValidationInputForTest({ kind: "layoutAbi" });
    const result = validateCheckedFactImportSchema({
      ...input,
      layoutFacts: { ...input.layoutFacts, keys: [] },
    });
    expect(expectImportError(result)).toContain("OPT_IR_FACT_IMPORT_LAYOUT_MISMATCH");
  });

  test("erasure imports value subjects only with matching Proof MIR value evidence", () => {
    const valueSubject = { kind: "value" as const, valueId: proofMirValueId(1) };
    const coreCertificate = {
      kind: "coreCertificate" as const,
      certificateId: proofCheckCoreCertificateId(1),
    };

    expect(
      validateCheckedFactImportSchema(
        completeFactImportValidationInputForTest({
          kind: "erasure",
          entry: checkedFactPacketEntryForTest({
            kind: "erasure",
            subject: valueSubject,
            dependencies: [{ kind: "proofMirValue", valueId: proofMirValueId(1) }, coreCertificate],
          }),
        }),
      ),
    ).toEqual({ kind: "ok", typedAnswers: EXPECTED_TYPED_ANSWERS.erasure });

    expect(
      expectImportError(
        validateCheckedFactImportSchemaForTest({
          entry: checkedFactPacketEntryForTest({
            kind: "erasure",
            subject: valueSubject,
            dependencies: [coreCertificate],
          }),
        }),
      ),
    ).toContain("OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY");
  });

  test("platformEffect imports call subjects as well as authority subjects", () => {
    const result = validateCheckedFactImportSchema(
      completeFactImportValidationInputForTest({
        kind: "platformEffect",
        entry: checkedFactPacketEntryForTest({
          kind: "platformEffect",
          subject: {
            kind: "call",
            functionInstanceId: monoInstanceId("fixture::main"),
            callId: proofMirCallId(1),
          },
        }),
      }),
    );

    expect(result).toEqual({ kind: "ok", typedAnswers: EXPECTED_TYPED_ANSWERS.platformEffect });
  });

  test("summary-instantiation dependencies resolve only against summary-instantiation certificates", () => {
    const certificateId = checkedSummaryInstantiationCertificateId(77);
    const baseEntry = checkedFactPacketEntryForTest({ kind: "ownership" });
    const entry = {
      ...baseEntry,
      dependencies: [
        ...baseEntry.dependencies,
        { kind: "summaryInstantiation" as const, certificateId },
      ],
    };
    const input = completeFactImportValidationInputForTest({ kind: "ownership", entry });

    expect(expectImportError(validateCheckedFactImportSchema(input))).toContain(
      "OPT_IR_FACT_IMPORT_MISSING_PROOF_MIR_NODE",
    );

    expect(
      validateCheckedFactImportSchema({
        ...input,
        handoff: {
          ...input.handoff,
          certificates: [
            ...input.handoff.certificates,
            {
              kind: "summaryInstantiation",
              certificateId,
              subjectKey: "summary:fixture",
              dependencyKeys: [],
            },
          ],
        },
      }),
    ).toEqual({ kind: "ok", typedAnswers: EXPECTED_TYPED_ANSWERS.ownership });
  });
});
