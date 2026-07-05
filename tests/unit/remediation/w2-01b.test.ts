import { describe, expect, test } from "bun:test";
import { proofMirPlaceId, proofMirValueId } from "../../../src/proof-mir/ids";
import { validateProofMirGraph } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirPlaceFake,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  proofMirValueFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("W2-01b scalar reference validation", () => {
  test("treats readValidatedBufferField result as a write, not a read", () => {
    const result = proofMirValueId(7);
    const sourcePlace = proofMirPlaceId(1);
    const diagnostics = validateProofMirGraph(
      proofMirValidatorProgramFake([
        proofMirValidatorFunctionFake({
          values: [proofMirValueFake({ valueId: result })],
          places: [proofMirPlaceFake({ placeId: sourcePlace })],
          statements: [
            {
              statementId: 0 as never,
              origin: validatorOrigin("read"),
              kind: {
                kind: "readValidatedBufferField",
                read: {
                  sourcePlace,
                  validatedBufferInstanceId: "buffer:0" as never,
                  fieldId: 1 as never,
                  layoutField: {
                    kind: "validatedBufferField",
                    instanceId: "buffer:0" as never,
                    fieldId: 1 as never,
                  },
                  offsetTerm: {
                    termId: 1 as never,
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
                    termId: 2 as never,
                    path: {
                      root: {
                        kind: "validatedBufferSourceLength",
                        instanceId: "buffer:0" as never,
                      },
                      childPath: [],
                    },
                    unit: "byteOffset",
                  },
                  termBindings: [],
                  readRequires: [],
                  result,
                  origin: validatorOrigin("read"),
                },
              },
            },
          ],
        }),
      ]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).not.toContain(
      `missing-definition:${String(result)}:statement:0`,
    );
  });
});
