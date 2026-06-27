import { describe, expect, test } from "bun:test";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirFactId,
  proofMirLayoutTermBindingId,
  proofMirLayoutTermId,
  proofMirLocalId,
  proofMirLoanId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirOwnedControlEdgeId,
  proofMirOwnedLayoutTermBindingId,
  proofMirOwnedPlaceId,
  proofMirOwnedValueId,
  proofMirPlaceId,
  proofMirPrivateStateGenerationId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
  proofMirScopeId,
  proofMirStatementId,
  proofMirTerminatorId,
  proofMirValueId,
  proofMirOwnedCallIdKey,
  proofMirOwnedControlEdgeIdKey,
  proofMirOwnedLayoutTermBindingIdKey,
  proofMirOwnedPlaceIdKey,
  proofMirOwnedValueIdKey,
} from "../../../src/proof-mir/ids";
import { monoInstanceId } from "../../../src/mono/ids";

describe("Proof MIR IDs", () => {
  test("numeric constructors preserve dense values", () => {
    expect(proofMirBlockId(0)).toBe(proofMirBlockId(0));
    expect(proofMirValueId(1)).toBe(proofMirValueId(1));
    expect(proofMirStatementId(2)).toBe(proofMirStatementId(2));
    expect(proofMirTerminatorId(3)).toBe(proofMirTerminatorId(3));
    expect(proofMirCallId(4)).toBe(proofMirCallId(4));
    expect(proofMirPlaceId(5)).toBe(proofMirPlaceId(5));
    expect(proofMirLocalId(6)).toBe(proofMirLocalId(6));
    expect(proofMirOriginId(7)).toBe(proofMirOriginId(7));
    expect(proofMirExitEdgeId(8)).toBe(proofMirExitEdgeId(8));
    expect(proofMirControlEdgeId(9)).toBe(proofMirControlEdgeId(9));
    expect(proofMirFactId(10)).toBe(proofMirFactId(10));
    expect(proofMirScopeId(11)).toBe(proofMirScopeId(11));
    expect(proofMirLoanId(12)).toBe(proofMirLoanId(12));
    expect(proofMirLayoutTermId(13)).toBe(proofMirLayoutTermId(13));
    expect(proofMirLayoutTermBindingId(14)).toBe(proofMirLayoutTermBindingId(14));
    expect(proofMirPrivateStateGenerationId(15)).toBe(proofMirPrivateStateGenerationId(15));
    expect(proofMirRuntimeOperationId(16)).toBe(proofMirRuntimeOperationId(16));
    expect(proofMirRuntimeCallId(17)).toBe(proofMirRuntimeCallId(17));
  });

  test("numeric constructors reject negative or non-integer values", () => {
    const constructors = [
      proofMirBlockId,
      proofMirValueId,
      proofMirStatementId,
      proofMirTerminatorId,
      proofMirCallId,
      proofMirPlaceId,
      proofMirLocalId,
      proofMirOriginId,
      proofMirExitEdgeId,
      proofMirControlEdgeId,
      proofMirFactId,
      proofMirScopeId,
      proofMirLoanId,
      proofMirLayoutTermId,
      proofMirLayoutTermBindingId,
      proofMirPrivateStateGenerationId,
      proofMirRuntimeOperationId,
      proofMirRuntimeCallId,
    ];

    for (const build of constructors) {
      expect(() => build(-1)).toThrow("non-negative integer");
      expect(() => build(1.5)).toThrow("non-negative integer");
      expect(() => build(NaN)).toThrow("non-negative integer");
      expect(() => build(Infinity)).toThrow("non-negative integer");
    }
  });

  test("owned proof id keys include function instance and id family", () => {
    const functionInstanceId = monoInstanceId("function:main");
    const ownedValue = proofMirOwnedValueId(functionInstanceId, proofMirValueId(3));

    expect(proofMirOwnedValueIdKey(ownedValue)).toBe("function:main/value:3");
  });

  test("ownedIdKey renders each owned id family", () => {
    const functionInstanceId = monoInstanceId("function:worker");

    expect(
      proofMirOwnedPlaceIdKey(proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(4))),
    ).toBe("function:worker/place:4");
    expect(proofMirOwnedCallIdKey(proofMirOwnedCallId(functionInstanceId, proofMirCallId(5)))).toBe(
      "function:worker/call:5",
    );
    expect(
      proofMirOwnedLayoutTermBindingIdKey(
        proofMirOwnedLayoutTermBindingId(functionInstanceId, proofMirLayoutTermBindingId(6)),
      ),
    ).toBe("function:worker/layoutTermBinding:6");
    expect(
      proofMirOwnedControlEdgeIdKey(
        proofMirOwnedControlEdgeId(functionInstanceId, proofMirControlEdgeId(7)),
      ),
    ).toBe("function:worker/controlEdge:7");
  });
});
