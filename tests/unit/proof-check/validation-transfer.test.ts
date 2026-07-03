import { describe, expect, test, beforeEach } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkValidationExitClosure,
  checkValidationSplitJoin,
  createValidation,
  matchValidation,
  resetValidationCertificateIdsForTest,
  transferValidationErrArm,
  transferValidationOkArm,
  validationTransferChain,
  type ValidationSplitJoinInput,
} from "../../../src/proof-check/domains/validation";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import {
  consumedPlaceForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  proofCheckStateForTest,
  uninitializedPlaceForTest,
  withTestPlaceResolver,
} from "../../support/proof-check/state-fixtures";

function validatedBufferLayoutForTest(bufferKey: string, layoutKey = "layout:Packet") {
  return { bufferKey, layoutKey };
}

export function validationSplitForTest(
  input: Pick<ValidationSplitJoinInput, "okState" | "errorState"> &
    Partial<Pick<ValidationSplitJoinInput, "validationKey" | "operationOriginKey">>,
): ValidationSplitJoinInput {
  return {
    okState: input.okState,
    errorState: input.errorState,
    ...(input.validationKey !== undefined ? { validationKey: input.validationKey } : {}),
    ...(input.operationOriginKey !== undefined
      ? { operationOriginKey: input.operationOriginKey }
      : {}),
  };
}

beforeEach(() => {
  resetValidationCertificateIdsForTest();
});

describe("createValidation", () => {
  test("validate creates one pending validation tied to source and validated-buffer instance", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("validation:pending"),
        ownedPlaceForTest("packet"),
      ],
    });

    const result = createValidation({
      state,
      validationKey: "validation:packet",
      sourcePlaceKey: "source",
      pendingResultPlaceKey: "validation:pending",
      packetPlaceKey: "packet",
      layoutKey: "layout:Packet",
      operationOriginKey: "origin:validate",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "validation",
        action: "open",
        validation: { validationKey: "validation:packet", status: "pending" },
      },
      {
        kind: "layout",
        layout: { bufferKey: "source", layoutKey: "layout:Packet" },
      },
    ]);
  });

  test("validate introduces an uninitialized pending result place", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        uninitializedPlaceForTest("proofMirPlace:0"),
        uninitializedPlaceForTest("packet"),
      ],
    });

    const result = createValidation({
      state,
      validationKey: "validation:packet",
      sourcePlaceKey: "source",
      pendingResultPlaceKey: "proofMirPlace:0",
      packetPlaceKey: "packet",
      layoutKey: "layout:Packet",
      operationOriginKey: "origin:validate",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toContainEqual({
      kind: "placeState",
      place: expect.any(Number),
      state: { placeKey: "proofMirPlace:0", lifecycle: "owned" },
    });
  });

  test("rejects duplicate validation key", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("source"), ownedPlaceForTest("validation:pending")],
      validations: [{ validationKey: "validation:packet", status: "pending" }],
    });

    const result = createValidation({
      state,
      validationKey: "validation:packet",
      sourcePlaceKey: "source",
      pendingResultPlaceKey: "validation:pending",
      packetPlaceKey: "packet",
      layoutKey: "layout:Packet",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_VALIDATION_SPLIT"),
    );
  });
});

describe("matchValidation", () => {
  test("matchValidation consumes the pending result exactly once", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("validation:pending"),
        ownedPlaceForTest("packet"),
      ],
      validations: [{ validationKey: "validation:packet", status: "pending" }],
      layout: [validatedBufferLayoutForTest("source")],
    });

    const first = matchValidation(
      withTestPlaceResolver({
        state,
        validationKey: "validation:packet",
        sourcePlaceKey: "source",
        packetPlaceKey: "packet",
        pendingResultPlaceKey: "validation:pending",
        layoutKey: "layout:Packet",
      }),
    );
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.armStates?.packetSourceCertificate?.rule).toBe("packetSource");

    const nextState = proofCheckStateForTest({
      validations: [{ validationKey: "validation:packet", status: "consumed" }],
    });
    const second = matchValidation({
      state: nextState,
      validationKey: "validation:packet",
      sourcePlaceKey: "source",
      packetPlaceKey: "packet",
      pendingResultPlaceKey: "validation:pending",
      layoutKey: "layout:Packet",
    });
    expect(second.kind).toBe("error");
    if (second.kind !== "error") return;
    expect(second.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_VALIDATION_SPLIT"),
    );
  });
});

describe("transferValidationOkArm", () => {
  test("ok edge consumes source into packet and introduces packet source and layout bounds", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("packet"),
        ownedPlaceForTest("packet.payload"),
      ],
    });

    const result = transferValidationOkArm(
      withTestPlaceResolver({
        state,
        validationKey: "validation:packet",
        sourcePlaceKey: "source",
        packetPlaceKey: "packet",
        payloadPlaceKey: "packet.payload",
        layoutKey: "layout:Packet",
        membershipBrandKey: "brand:batch",
        operationOriginKey: "origin:validation:ok",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some(
        (patch) =>
          patch.kind === "placeState" &&
          patch.state.placeKey === "source" &&
          patch.state.lifecycle === "consumed",
      ),
    ).toBe(true);
    expect(result.patches.some((patch) => patch.kind === "packetSource")).toBe(true);
    expect(
      result.patches.some(
        (patch) => patch.kind === "layout" && patch.layout.bufferKey === "packet",
      ),
    ).toBe(true);
    const packetSourceEntry = result.packetEntries.find((entry) => entry.kind === "packetSource");
    expect(packetSourceEntry).toBeDefined();
    expect(packetSourceEntry?.dependencies.map((dependency) => dependency.kind).sort()).toEqual([
      "coreCertificate",
      "packetSource",
      "proofMirPlace",
      "proofMirPlace",
    ]);
  });
});

describe("transferValidationErrArm", () => {
  test("err edge keeps source live and introduces no packet", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("source")],
    });

    const result = transferValidationErrArm({
      state,
      validationKey: "validation:packet",
      sourcePlaceKey: "source",
      operationOriginKey: "origin:validation:err",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.some((patch) => patch.kind === "packetSource")).toBe(false);
    expect(
      result.patches.some(
        (patch) => patch.kind === "placeState" && patch.state.placeKey === "source",
      ),
    ).toBe(false);
  });

  test("err edge initializes materialized error payload aliases", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        uninitializedPlaceForTest("status"),
        uninitializedPlaceForTest("status:alias"),
      ],
    });

    const result = transferValidationErrArm(
      withTestPlaceResolver({
        state,
        validationKey: "validation:packet",
        sourcePlaceKey: "source",
        errPayloadPlaceKey: "status",
        additionalOwnedPlaceKeys: ["status:alias"],
        operationOriginKey: "origin:validation:err",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.filter((patch) => patch.kind === "placeState").map((patch) => patch.state),
    ).toEqual([
      { placeKey: "status", lifecycle: "owned" },
      { placeKey: "status:alias", lifecycle: "owned" },
    ]);
  });
});

describe("checkValidationSplitJoin", () => {
  test("validation ok arm leaking packet while err arm keeps source fails split join", () => {
    const result = checkValidationSplitJoin(
      validationSplitForTest({
        okState: proofCheckStateForTest({
          packetSources: [packetSourceForTest("packet", "source")],
        }),
        errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("source")] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
  });

  test("convergent repaired arms accept split join", () => {
    const convergentState = proofCheckStateForTest({
      places: [ownedPlaceForTest("source")],
    });

    const result = checkValidationSplitJoin(
      validationSplitForTest({
        okState: convergentState,
        errorState: convergentState,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.meetKind).toBe("exact");
    expect(proofCheckStateKey(result.state)).toBe(proofCheckStateKey(convergentState));
  });
});

describe("checkValidationExitClosure", () => {
  test("return with pending validation is rejected", () => {
    const state = proofCheckStateForTest({
      validations: [{ validationKey: "validation:packet", status: "pending" }],
    });

    const result = checkValidationExitClosure({
      state,
      exitKind: "return",
      operationOriginKey: "origin:return",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_VALIDATION"),
    );
  });

  test("return with live validation source is rejected", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("source")],
      layout: [validatedBufferLayoutForTest("source")],
    });

    const result = checkValidationExitClosure({
      state,
      exitKind: "return",
      operationOriginKey: "origin:return",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_VALIDATION"),
    );
  });

  test("return with live packet token is rejected", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet")],
      packetSources: [packetSourceForTest("packet", "source")],
    });

    const result = checkValidationExitClosure({
      state,
      exitKind: "return",
      operationOriginKey: "origin:return",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_PACKET"));
  });

  test("return ignores consumed packet provenance", () => {
    const state = proofCheckStateForTest({
      places: [consumedPlaceForTest("packet")],
      packetSources: [packetSourceForTest("packet", "source")],
    });

    const result = checkValidationExitClosure({
      state,
      exitKind: "return",
      operationOriginKey: "origin:return",
    });

    expect(result.kind).toBe("ok");
  });
});

describe("validationTransferChain", () => {
  test("create and match produce arm states with packet source certificate", () => {
    const initialState = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("validation:pending"),
        ownedPlaceForTest("packet"),
      ],
    });

    const result = validationTransferChain(
      initialState,
      [
        {
          kind: "create",
          input: {
            validationKey: "validation:packet",
            sourcePlaceKey: "source",
            pendingResultPlaceKey: "validation:pending",
            packetPlaceKey: "packet",
            layoutKey: "layout:Packet",
          },
        },
        {
          kind: "match",
          input: {
            validationKey: "validation:packet",
            sourcePlaceKey: "source",
            packetPlaceKey: "packet",
            pendingResultPlaceKey: "validation:pending",
            layoutKey: "layout:Packet",
            payloadPlaceKey: "packet.payload",
            membershipBrandKey: "brand:batch",
          },
        },
      ],
      { placeResolver: withTestPlaceResolver({ state: initialState }).placeResolver },
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.armStates?.okState.places.get("source")?.lifecycle).toBe("consumed");
    expect(result.armStates?.errorState.places.get("source")?.lifecycle).toBe("owned");
    expect(result.armStates?.okState.packetSources.size).toBe(1);
    expect(result.armStates?.errorState.packetSources.size).toBe(0);
  });
});
