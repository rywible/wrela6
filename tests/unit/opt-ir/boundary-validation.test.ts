import { describe, expect, test } from "bun:test";

import { validateOptIrConstructionBoundary } from "../../../src/opt-ir/boundary-validation";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { constructOptIrInputForTest } from "../../support/opt-ir/internal-construction-fixtures";
import { checkedOptIrHandoffForTest } from "../../support/opt-ir/opt-ir-handoff-fixtures";
import {
  checkedFactPacketEntryForOptIrTest,
  checkedFactPacketWithEveryKindForOptIrTest,
} from "../../support/opt-ir/fact-packet-fixtures";
import { checkedOptIrHandoffFingerprint } from "../../../src/proof-check/model/opt-ir-handoff";
import { checkedFunctionSummaryCertificateId } from "../../../src/proof-check/model/certificates";
import { emptyCheckedFactPacket, layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import { proofCheckPathCertificateId } from "../../../src/proof-check/ids";
import type { OptIrBoundaryValidationResult } from "../../../src/opt-ir/boundary-validation";

function withHandoffFacts(
  handoff: ReturnType<typeof checkedOptIrHandoffForTest>,
  facts: typeof handoff.checkedMir.facts,
): ReturnType<typeof checkedOptIrHandoffForTest> {
  const checkedMir = { ...handoff.checkedMir, facts };
  const withoutFingerprint = {
    ...handoff,
    checkedMir,
    packetValidation: {
      ...handoff.packetValidation,
      checkedFactPacketStableKey: JSON.stringify(facts),
    },
  };
  return {
    ...withoutFingerprint,
    handoffFingerprint: checkedOptIrHandoffFingerprint(withoutFingerprint),
  };
}

function expectError(result: OptIrBoundaryValidationResult) {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") {
    throw new Error("Expected boundary validation to return diagnostics.");
  }
  return result;
}

describe("validateOptIrConstructionBoundary", () => {
  test("accepts a complete checked handoff with authenticated layout and target catalogs", () => {
    const result = validateOptIrConstructionBoundary(
      constructOptIrInputForTest({
        handoff: checkedOptIrHandoffForTest({
          includePathCertificates: true,
          includeSemanticInlinePolicies: true,
        }),
      }),
    );

    expect(result.kind).toBe("ok");
  });

  test("rejects a path-scoped fact without a matching path certificate", () => {
    const handoff = checkedOptIrHandoffForTest({ includePathCertificates: false });
    const pathScopedFact = checkedFactPacketEntryForOptIrTest({
      kind: "validatedBuffer",
      scope: { kind: "path", certificateId: proofCheckPathCertificateId(99) },
    });

    const result = validateOptIrConstructionBoundary(
      constructOptIrInputForTest({
        handoff: withHandoffFacts(handoff, {
          ...emptyCheckedFactPacket(),
          validatedBuffers: [pathScopedFact],
        }),
      }),
    );

    const error = expectError(result);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_MISSING_PATH_CERTIFICATE"),
    );
  });

  test("rejects a missing mandatory semantic-inline policy for a checked summary", () => {
    const handoff = checkedOptIrHandoffForTest({
      includeSemanticInlinePolicies: true,
    });
    const withoutInlinePolicies = {
      ...handoff,
      semanticInlinePolicies: [],
    };

    const result = validateOptIrConstructionBoundary(
      constructOptIrInputForTest({
        handoff: {
          ...withoutInlinePolicies,
          handoffFingerprint: checkedOptIrHandoffFingerprint(withoutInlinePolicies),
        },
      }),
    );

    const error = expectError(result);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_MISSING_SEMANTIC_INLINE_POLICY"),
    );
  });

  test("rejects stale packet-validation and handoff fingerprints", () => {
    const handoff = checkedOptIrHandoffForTest();
    const checkedFunction = [...handoff.checkedMir.checkedFunctions.values()][0]!;
    const checkedMir = {
      ...handoff.checkedMir,
      checkedFunctions: new Map([
        [
          checkedFunction.functionInstanceId,
          {
            ...checkedFunction,
            summaryCertificate: checkedFunctionSummaryCertificateId(12345),
          },
        ],
      ]),
    };

    const result = validateOptIrConstructionBoundary(
      constructOptIrInputForTest({
        handoff: {
          ...handoff,
          checkedMir,
        },
      }),
    );

    const error = expectError(result);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID"),
    );
  });

  test("rejects layout, ABI, platform, and runtime facts that cannot authenticate", () => {
    const allFacts = checkedFactPacketWithEveryKindForOptIrTest();
    const handoff = withHandoffFacts(checkedOptIrHandoffForTest(), {
      ...allFacts,
      layoutAbi: [
        checkedFactPacketEntryForOptIrTest({
          kind: "layoutAbi",
          subject: { kind: "layout", layoutKey: layoutFactKey("missing:layout") },
          dependencies: [{ kind: "layoutFact", layoutKey: layoutFactKey("missing:layout") }],
        }),
      ],
      platformEffects: [
        checkedFactPacketEntryForOptIrTest({
          kind: "platformEffect",
          subject: {
            kind: "authority",
            fingerprint: constructOptIrInputForTest().target.platformEffects.fingerprint,
            entryKey: "missing.platform",
          },
          dependencies: [
            {
              kind: "authorityEntry",
              fingerprint: constructOptIrInputForTest().target.platformEffects.fingerprint,
              entryKey: "missing.platform",
            },
          ],
        }),
      ],
      capabilityFlow: [
        checkedFactPacketEntryForOptIrTest({
          kind: "capabilityFlow",
          dependencies: [
            {
              kind: "authorityEntry",
              fingerprint: constructOptIrInputForTest().target.runtimeEffects.fingerprint,
              entryKey: "missing.runtime",
            },
          ],
        }),
      ],
    });

    const result = validateOptIrConstructionBoundary(constructOptIrInputForTest({ handoff }));

    const error = expectError(result);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_LAYOUT_AUTHORITY_MISMATCH"),
    );
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH"),
    );
  });

  test("reports missing required handoff artifacts as OptIR diagnostics", () => {
    const handoff = checkedOptIrHandoffForTest();
    const result = validateOptIrConstructionBoundary(
      constructOptIrInputForTest({
        handoff: {
          ...handoff,
          packetValidation: undefined,
        } as unknown as typeof handoff,
      }),
    );

    const error = expectError(result);
    expect(error.diagnostics).toHaveLength(1);
    expect(error.diagnostics[0]?.code).toBe(optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID"));
  });
});
