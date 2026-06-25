import { expect, test } from "bun:test";
import {
  functionId,
  parameterId,
  platformContractId,
  platformPrimitiveId,
  targetId,
} from "../../../../src/semantic/ids";
import { SourceSpan } from "../../../../src/frontend";
import {
  CheckedPlatformEnsuredFactSurfaceTableBuilder,
  CheckedPrivateTransitionSurfaceTableBuilder,
  populatePlatformEnsuredFactSurfaces,
  populatePrivateTransitionSurfaces,
} from "../../../../src/semantic/surface/proof-contracts";

const span = SourceSpan.from(0, 6);

test("private transition surface preserves close classification", () => {
  const builder = new CheckedPrivateTransitionSurfaceTableBuilder();
  builder.add({
    functionId: functionId(5),
    kind: "close",
    receiverParameterId: parameterId(0),
    span,
  });

  expect(builder.build().get(functionId(5))[0]!.kind).toBe("close");
});

test("private transition population preserves predicate advance close and unknown deterministically", () => {
  const builder = new CheckedPrivateTransitionSurfaceTableBuilder();

  populatePrivateTransitionSurfaces(builder, {
    transitions: [
      { functionId: functionId(4), kind: "unknown", span },
      { functionId: functionId(2), kind: "close", receiverParameterId: parameterId(0), span },
      { functionId: functionId(1), kind: "predicate", receiverParameterId: parameterId(0), span },
      { functionId: functionId(3), kind: "advance", receiverParameterId: parameterId(0), span },
    ],
  });

  expect(
    builder
      .build()
      .entries()
      .map((entry) => entry.kind),
  ).toEqual(["predicate", "close", "advance", "unknown"]);
});

test("platform ensured fact surfaces preserve structured predicate records", () => {
  const builder = new CheckedPlatformEnsuredFactSurfaceTableBuilder();

  populatePlatformEnsuredFactSurfaces(builder, {
    certifiedBindings: [
      {
        sourceFunctionId: functionId(1),
        primitiveId: platformPrimitiveId("prim"),
        contractId: platformContractId("contract"),
        targetId: targetId("target"),
        ensuredFacts: [
          {
            fingerprint: "predicate:1",
            fact: {
              kind: "predicate",
              predicateFunctionId: functionId(9),
              argumentBindings: [{ kind: "parameter", parameterId: parameterId(0) }],
            },
          },
        ],
      },
    ],
  });

  expect(builder.build().entries()).toEqual([
    {
      sourceFunctionId: functionId(1),
      primitiveId: platformPrimitiveId("prim"),
      contractId: platformContractId("contract"),
      targetId: targetId("target"),
      fingerprint: "predicate:1",
      fact: {
        kind: "predicate",
        predicateFunctionId: functionId(9),
        argumentBindings: [{ kind: "parameter", parameterId: parameterId(0) }],
      },
    },
  ]);
});
