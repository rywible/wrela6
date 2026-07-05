import { describe, expect, test } from "bun:test";
import { proofMirFactId, proofMirPlaceId, proofMirValueId } from "../../../src/proof-mir/ids";
import { collectStatementReferences } from "../../../src/proof-mir/validation/reference-collector";
import { validatorOrigin } from "../../support/proof-mir/validator-program-fakes";

describe("W2-01a statement reference collector", () => {
  test("collects scalar reads, scalar writes, facts, and places from one statement", () => {
    const references = collectStatementReferences({
      statementId: 0 as never,
      origin: validatorOrigin("collector"),
      kind: {
        kind: "readValidatedBufferField",
        read: {
          sourcePlace: proofMirPlaceId(1),
          packetPlace: proofMirPlaceId(2),
          validatedBufferInstanceId: "buffer:0" as never,
          fieldId: 3 as never,
          layoutField: {
            kind: "validatedBufferField",
            instanceId: "buffer:0" as never,
            fieldId: 3 as never,
          },
          offsetTerm: {
            termId: 10 as never,
            path: {
              root: {
                kind: "validatedBufferSourceLength",
                instanceId: "buffer:0" as never,
              },
              childPath: [],
            },
            unit: "byteOffset",
          },
          endTerm: {
            termId: 11 as never,
            path: {
              root: {
                kind: "validatedBufferSourceLength",
                instanceId: "buffer:0" as never,
              },
              childPath: [],
            },
            unit: "byteOffset",
          },
          termBindings: [12 as never],
          readRequires: [proofMirFactId(13)],
          result: proofMirValueId(14),
          origin: validatorOrigin("read"),
        },
      },
    });

    expect(references.reads).toEqual([]);
    expect(references.writes).toEqual([proofMirValueId(14)]);
    expect(references.facts).toEqual([proofMirFactId(13)]);
    expect(references.places).toEqual([proofMirPlaceId(1), proofMirPlaceId(2)]);
    expect(references.layoutTerms.map((term) => term.termId)).toEqual([10 as never, 11 as never]);
  });
});
