import { describe, expect, test, beforeEach } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirBlockId } from "../../../src/proof-mir/ids";
import type { ProofCheckGuardedPostcondition } from "../../../src/proof-check/authority/platform-contracts";
import { proofCheckAuthorityTerminalCallIdForTest } from "../../../src/proof-check/authority/platform-contracts";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  applyPlatformContractEffects,
  applyPlatformEffectInvalidation,
  applyPlatformGuardedPostconditions,
  resetPlatformEffectCertificateIdsForTest,
  type PlatformGuardedPostconditionInput,
} from "../../../src/proof-check/domains/platform-contract-effects";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { resetProofCheckPrivateStateCertificateIdsForTest } from "../../../src/proof-check/domains/private-state";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import {
  platformEffectKindId,
  syntheticBinderId,
} from "../../../src/proof-check/model/fact-language";
import {
  activeFactForTest,
  packetSourceForTest,
  privateGenerationForTest,
  proofCheckStateForTest,
  testPlaceResolverForKeys,
} from "../../support/proof-check/state-fixtures";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";
import { contractForTest } from "./platform-contract-transfer.test";

export function initializedPrefixAdvanceWhenContiguousForTest(): ProofCheckGuardedPostcondition {
  return {
    when: [
      comparisonTerm(valueTerm("offset"), "eq", {
        kind: "preState",
        operand: valueTerm("initialized_prefix"),
      }),
    ],
    consequentTerms: [
      comparisonTerm(
        { kind: "postState", operand: valueTerm("initialized_prefix") },
        "eq",
        literalInt(1n),
      ),
    ],
    authorityKey: "platform:write-u8:contiguous",
  };
}

export function initializedPrefixPreserveWhenInBoundsForTest(): ProofCheckGuardedPostcondition {
  return {
    when: [
      comparisonTerm(valueTerm("offset"), "lt", {
        kind: "preState",
        operand: valueTerm("initialized_prefix"),
      }),
    ],
    consequentTerms: [
      comparisonTerm({ kind: "postState", operand: valueTerm("initialized_prefix") }, "eq", {
        kind: "preState",
        operand: valueTerm("initialized_prefix"),
      }),
    ],
    authorityKey: "platform:write-u8:preserve",
  };
}

export function platformEffectInputForTest(
  input: {
    readonly state?: ReturnType<typeof proofCheckStateForTest>;
    readonly preFacts?: PlatformGuardedPostconditionInput["preFacts"];
    readonly postconditions?: PlatformGuardedPostconditionInput["postconditions"];
    readonly guardedPostconditions?: PlatformGuardedPostconditionInput["guardedPostconditions"];
    readonly operationOriginKey?: string;
  } = {},
): PlatformGuardedPostconditionInput {
  return {
    state: input.state ?? proofCheckStateForTest(),
    preFacts: input.preFacts ?? [],
    ...(input.postconditions === undefined ? {} : { postconditions: input.postconditions }),
    guardedPostconditions: input.guardedPostconditions ?? [],
    operationOriginKey: input.operationOriginKey ?? "test:platform-effects",
  };
}

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
  resetProofCheckPrivateStateCertificateIdsForTest();
  resetPlatformEffectCertificateIdsForTest();
});

describe("applyPlatformGuardedPostconditions", () => {
  test("sparse write does not produce initialized-prefix advancement fact", () => {
    const result = applyPlatformGuardedPostconditions(
      platformEffectInputForTest({
        preFacts: [comparisonTerm(valueTerm("offset"), "gt", valueTerm("initialized_prefix"))],
        guardedPostconditions: [initializedPrefixAdvanceWhenContiguousForTest()],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch.entries.some((entry) => entry.kind === "fact")).toBe(false);
  });

  test("contiguous write advances initialized prefix when when-clause matches", () => {
    const result = applyPlatformGuardedPostconditions(
      platformEffectInputForTest({
        preFacts: [
          comparisonTerm(valueTerm("offset"), "eq", valueTerm("initialized_prefix")),
          comparisonTerm(valueTerm("initialized_prefix"), "eq", literalInt(0n)),
        ],
        guardedPostconditions: [initializedPrefixAdvanceWhenContiguousForTest()],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patch.entries.some(
        (entry) =>
          entry.kind === "fact" &&
          entry.action === "add" &&
          entry.fact.termKey.includes("initialized_prefix"),
      ),
    ).toBe(true);
  });

  test("otherwisePreserves applies prefix preservation for in-bounds sparse writes", () => {
    const result = applyPlatformGuardedPostconditions(
      platformEffectInputForTest({
        preFacts: [
          comparisonTerm(valueTerm("offset"), "lt", valueTerm("initialized_prefix")),
          comparisonTerm(valueTerm("initialized_prefix"), "eq", literalInt(4n)),
        ],
        guardedPostconditions: [initializedPrefixPreserveWhenInBoundsForTest()],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patch.entries.some(
        (entry) =>
          entry.kind === "fact" &&
          entry.action === "add" &&
          entry.fact.termKey.includes("preState"),
      ),
    ).toBe(true);
  });

  test("relational postconditions preserve descriptor relationships across transfer", () => {
    const result = applyPlatformGuardedPostconditions(
      platformEffectInputForTest({
        postconditions: [
          comparisonTerm({ kind: "postState", operand: valueTerm("result.written_len") }, "eq", {
            kind: "preState",
            operand: valueTerm("argument.written_len"),
          }),
          comparisonTerm({ kind: "postState", operand: valueTerm("result.capacity") }, "eq", {
            kind: "preState",
            operand: valueTerm("argument.capacity"),
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch.entries.filter((entry) => entry.kind === "fact")).toHaveLength(2);
  });
});

describe("applyPlatformEffectInvalidation", () => {
  test("writesMemory drops facts depending on touched buffer subject", () => {
    const state = proofCheckStateForTest({
      facts: [
        activeFactForTest("buffer:initialized_prefix"),
        activeFactForTest("buffer:capacity"),
        activeFactForTest("other:initialized_prefix"),
      ],
    });

    const result = applyPlatformEffectInvalidation({
      state,
      effect: {
        kind: "writesMemory",
        place: { kind: "synthetic", id: syntheticBinderId("buffer") },
      },
      preservationFacts: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.map((patch) => patch.kind === "fact" && patch.fact.factKey)).toEqual([
      "buffer:capacity",
      "buffer:initialized_prefix",
    ]);
  });

  test("preservation facts keep selected catalog relationships across invalidation", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("buffer:capacity"), activeFactForTest("buffer:initialized_prefix")],
    });
    const preservation = comparisonTerm(
      { kind: "postState", operand: valueTerm("buffer.capacity") },
      "eq",
      { kind: "preState", operand: valueTerm("buffer.capacity") },
    );

    const result = applyPlatformEffectInvalidation({
      state,
      effect: {
        kind: "writesMemory",
        place: { kind: "synthetic", id: syntheticBinderId("buffer") },
      },
      preservationFacts: [preservation],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some(
        (patch) => patch.kind === "fact" && patch.fact.factKey === "buffer:capacity",
      ),
    ).toBe(false);
    expect(
      result.patches.some(
        (patch) => patch.kind === "fact" && patch.fact.factKey === "buffer:initialized_prefix",
      ),
    ).toBe(true);
  });
});

describe("applyPlatformContractEffects", () => {
  test("doesNotReturn emits divergence patch entries and exit-closure packet facts", () => {
    const contract = contractForTest({
      preconditions: [],
      effects: [{ kind: "doesNotReturn" }],
    });

    const result = applyPlatformContractEffects({
      state: proofCheckStateForTest(),
      contract,
      operationOriginKey: "platform:exit",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch.entries.some((entry) => entry.kind === "divergence")).toBe(true);
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("exitClosure")),
    ).toBe(true);
  });

  test("writesMemory emits platformEffect packet certificates", () => {
    const contract = contractForTest({
      preconditions: [],
      effects: [
        {
          kind: "writesMemory",
          place: { kind: "synthetic", id: syntheticBinderId("buffer") },
        },
      ],
    });

    const result = applyPlatformContractEffects({
      state: proofCheckStateForTest(),
      contract,
      placeResolver: testPlaceResolverForKeys(["buffer"]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("platformEffect")),
    ).toBe(true);
  });

  test("advancesPrivateState emits privateState patch entries", () => {
    const contract = contractForTest({
      preconditions: [],
      effects: [
        {
          kind: "advancesPrivateState",
          place: { kind: "synthetic", id: syntheticBinderId("cell") },
        },
      ],
    });

    const result = applyPlatformContractEffects({
      state: proofCheckStateForTest({
        privateState: [privateGenerationForTest("cell", "generation:1")],
      }),
      contract,
      privateStateAdvance: {
        placeKey: "cell",
        nextGenerationKey: "generation:2",
        transitionKey: "platform:close",
      },
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("fn:main"),
        blockId: proofMirBlockId(0),
      },
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch.entries.some((entry) => entry.kind === "privateState")).toBe(true);
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("privateState")),
    ).toBe(true);
  });

  test("terminal postconditions emit terminal patch entries and certificates", () => {
    const contract = contractForTest({
      preconditions: [],
      postconditions: [
        {
          kind: "terminalCall",
          call: proofCheckAuthorityTerminalCallIdForTest(1),
          terminalKind: "platformExit",
        },
      ],
    });

    const result = applyPlatformContractEffects({
      state: proofCheckStateForTest(),
      contract,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch.entries.some((entry) => entry.kind === "terminal")).toBe(true);
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("terminalClosure")),
    ).toBe(true);
  });

  test("platformEffect invalidates touched packet source facts by default", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("packet:brand:rx")],
      packetSources: [packetSourceForTest("packet", "buffer")],
    });
    const contract = contractForTest({
      preconditions: [],
      effects: [
        {
          kind: "platformEffect",
          effectKind: platformEffectKindId("publish"),
        },
      ],
    });

    const result = applyPlatformContractEffects({
      state,
      contract,
      placeResolver: testPlaceResolverForKeys(["subject", "packet", "buffer"]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patch.entries.some((entry) => entry.kind === "fact" && entry.action === "drop"),
    ).toBe(true);
  });

  test("missing private-state advance reports deterministic mismatch", () => {
    const contract = contractForTest({
      preconditions: [],
      effects: [
        {
          kind: "advancesPrivateState",
          place: { kind: "synthetic", id: syntheticBinderId("cell") },
        },
      ],
    });

    const result = applyPlatformContractEffects({
      state: proofCheckStateForTest(),
      contract,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PRIVATE_STATE_ADVANCE_MISMATCH"),
    );
  });
});
