import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofCheckTransitionId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactSubject,
} from "../../../src/proof-check/model/fact-packet";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import { proofCheckPatchKind } from "../../../src/proof-check/kernel/state-patch";
import {
  PROOF_CHECK_OPERATION_KINDS,
  acceptProofCheckBlockEntryState,
  applyProofCheckTransitionResult,
  createProofCheckPacketStage,
  discardStagedPacketEntriesForStateKey,
  proofCheckOperationKind,
  proofCheckOperationKindOf,
  proofCheckProgramPointKey,
  type ProofCheckOperation,
  type ProofCheckProgramPoint,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../../../src/proof-check/kernel/transition-api";
import type { ProofMirCallGraphEdge } from "../../../src/proof-mir/model/calls";
import type {
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirStatement,
  ProofMirTerminator,
} from "../../../src/proof-mir/model/graph";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirPlaceId,
  proofMirStatementId,
  proofMirTerminatorId,
  type ProofMirBlockId,
  type ProofMirControlEdgeId,
  type ProofMirExitEdgeId,
  type ProofMirOwnedCallId,
  type ProofMirStatementId,
  type ProofMirTerminatorId,
} from "../../../src/proof-mir/ids";
import {
  activeFactForTest,
  proofCheckDiagnosticForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultFunctionInstanceId = monoInstanceId("1");
const defaultBlockId = proofMirBlockId(0);
const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

export interface TransitionForTestInput {
  readonly transitionId?: ReturnType<typeof proofCheckTransitionId>;
  readonly functionInstanceId?: ReturnType<typeof monoInstanceId>;
  readonly location?: ProofCheckProgramPoint;
  readonly inputState?: ReturnType<typeof proofCheckStateForTest>;
  readonly operation?: ProofCheckOperation;
}

function proofMirStatementForTest(statementId: ProofMirStatementId): ProofMirStatement {
  return {
    statementId,
    kind: {
      kind: "literal",
      value: 0 as never,
      literal: { kind: "integer", text: "0", value: 0n },
    },
    origin: proofMirOriginId(0),
  };
}

function proofMirTerminatorForTest(terminatorId: ProofMirTerminatorId): ProofMirTerminator {
  return {
    terminatorId,
    kind: { kind: "unreachable", reason: "unreachableSource" },
    outgoingEdges: [],
    origin: proofMirOriginId(0),
  };
}

function proofMirControlEdgeForTest(input: {
  readonly edgeId: ProofMirControlEdgeId;
  readonly fromBlockId?: ProofMirBlockId;
  readonly toBlockId?: ProofMirBlockId;
}): ProofMirControlEdge {
  return {
    edgeId: input.edgeId,
    fromBlockId: input.fromBlockId ?? defaultBlockId,
    ...(input.toBlockId !== undefined ? { toBlockId: input.toBlockId } : {}),
    kind: "normal",
    arguments: [],
    facts: [],
    effects: [],
    crossedScopes: [],
    origin: proofMirOriginId(0),
  };
}

function proofMirCallGraphEdgeForTest(callId: ProofMirOwnedCallId): ProofMirCallGraphEdge {
  return {
    callId,
    target: {
      kind: "sourceFunction",
      functionInstanceId: defaultFunctionInstanceId,
      abi: { kind: "functionAbi", functionInstanceId: defaultFunctionInstanceId },
    },
    origin: proofMirOriginId(0),
  };
}

function proofMirExitEdgeForTest(exitId: ProofMirExitEdgeId): ProofMirExitEdge {
  return {
    exitId,
    fromBlockId: defaultBlockId,
    kind: "ordinaryReturn",
    boundary: { kind: "function", unwind: "none" },
    crossedScopes: [],
    closure: {
      kind: "functionExit",
      requireNoLiveLoans: true,
      requireNoOpenObligations: true,
      requireNoLiveSessionMembers: true,
      requireNoPendingValidationResults: true,
      terminalReachability: "notRequired",
    },
    origin: proofMirOriginId(0),
  };
}

function defaultStatementLocation(
  statementId: ProofMirStatementId = proofMirStatementId(1),
): ProofCheckProgramPoint {
  return {
    kind: "statement",
    functionInstanceId: defaultFunctionInstanceId,
    blockId: defaultBlockId,
    statementId,
  };
}

function defaultStatementOperation(
  statementId: ProofMirStatementId = proofMirStatementId(1),
): ProofCheckOperation {
  return {
    kind: "statement",
    statement: proofMirStatementForTest(statementId),
  };
}

export function transitionForTest(
  input: string | TransitionForTestInput = {},
): ProofCheckTransition {
  if (typeof input === "string") {
    const [kind, rawId] = input.split(":");
    const numericId = Number(rawId ?? "1");

    switch (kind) {
      case "statement":
        return transitionForTest({
          location: defaultStatementLocation(proofMirStatementId(numericId)),
          operation: defaultStatementOperation(proofMirStatementId(numericId)),
        });
      case "join":
        return transitionForTest({
          location: {
            kind: "join",
            functionInstanceId: defaultFunctionInstanceId,
            blockId: proofMirBlockId(numericId),
          },
          operation: { kind: "join", blockId: proofMirBlockId(numericId) },
        });
      default:
        throw new RangeError(`Unsupported transitionForTest shorthand: ${input}.`);
    }
  }

  const statementId = proofMirStatementId(1);
  return {
    transitionId: input.transitionId ?? proofCheckTransitionId(1),
    functionInstanceId: input.functionInstanceId ?? defaultFunctionInstanceId,
    location: input.location ?? defaultStatementLocation(statementId),
    inputState: input.inputState ?? proofCheckStateForTest(),
    operation: input.operation ?? defaultStatementOperation(statementId),
  };
}

function ownershipPacketEntryForTest(): CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
> {
  return {
    factId: proofCheckPacketFactId(1),
    kind: checkedFactKindId("ownership"),
    subject: { kind: "place", placeId: proofMirPlaceId(1) },
    scope: {
      kind: "blockEntry",
      functionInstanceId: defaultFunctionInstanceId,
      blockId: defaultBlockId,
    },
    dependencies: [{ kind: "proofMirPlace", placeId: proofMirPlaceId(1) }],
    invalidatedBy: [{ kind: "placeMove", placeId: proofMirPlaceId(1) }],
    certificate: defaultCertificate,
    origin: {
      originKey: "origin:ownership:1",
      proofMirOriginId: proofMirOriginId(1),
    },
  };
}

function okTransferForTest(input?: {
  readonly packetEntries?: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly patchEntries?: ReturnType<typeof proofCheckStatePatchForTest>["entries"];
}): ProofCheckTransitionResult {
  return {
    kind: "ok",
    patch: proofCheckStatePatchForTest({
      kind: "coreTransfer",
      entries: input?.patchEntries ?? [
        {
          kind: "fact",
          action: "add",
          fact: activeFactForTest("fact:new"),
        },
      ],
    }),
    certificates: [defaultCertificate],
    packetEntries: input?.packetEntries ?? [ownershipPacketEntryForTest()],
    diagnostics: [],
  };
}

describe("ProofCheckOperation", () => {
  test("ProofCheckOperation is exactly the closed operation kind list", () => {
    expect([...PROOF_CHECK_OPERATION_KINDS].sort()).toEqual([
      "call",
      "edge",
      "exit",
      "functionEntry",
      "join",
      "loopHeader",
      "statement",
      "terminalClosure",
      "terminator",
    ]);
  });

  test("proofCheckOperationKind rejects unknown operation kinds", () => {
    expect(() => proofCheckOperationKind("not-an-operation")).toThrow(
      "Unknown proof-check operation kind",
    );
  });

  test("proofCheckOperationKindOf reports the operation variant", () => {
    const operation: ProofCheckOperation = {
      kind: "join",
      blockId: proofMirBlockId(2),
    };
    expect(proofCheckOperationKindOf(operation)).toBe(proofCheckOperationKind("join"));
  });
});

describe("ProofCheckTransition", () => {
  test("ProofCheckTransition contains transition id, function, location, input state, and operation", () => {
    const inputState = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    const transition = transitionForTest({
      transitionId: proofCheckTransitionId(7),
      functionInstanceId: monoInstanceId("3"),
      location: defaultStatementLocation(proofMirStatementId(4)),
      inputState,
      operation: defaultStatementOperation(proofMirStatementId(4)),
    });

    expect(transition.transitionId).toBe(proofCheckTransitionId(7));
    expect(transition.functionInstanceId).toBe(monoInstanceId("3"));
    expect(transition.location.kind).toBe("statement");
    expect(transition.inputState).toBe(inputState);
    expect(transition.operation.kind).toBe("statement");
  });

  test("proofCheckProgramPointKey is stable for statement locations", () => {
    const location = defaultStatementLocation(proofMirStatementId(1));
    expect(proofCheckProgramPointKey(location)).toBe("statement/function:1/block:0/statement:1");
  });
});

describe("ProofCheckTransitionResult", () => {
  test("ok transfer exposes patch, certificates, packet entries, and diagnostics", () => {
    const transfer = okTransferForTest();
    expect(transfer.kind).toBe("ok");
    if (transfer.kind !== "ok") return;
    expect(transfer.patch.kind).toBe(proofCheckPatchKind("coreTransfer"));
    expect(transfer.certificates).toHaveLength(1);
    expect(transfer.packetEntries).toHaveLength(1);
    expect(transfer.diagnostics).toEqual([]);
  });

  test("error transfer exposes diagnostics only", () => {
    const transfer: ProofCheckTransitionResult = {
      kind: "error",
      diagnostics: [proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT")],
    };
    expect(transfer.kind).toBe("error");
    if (transfer.kind !== "error") return;
    expect(transfer.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
  });
});

describe("applyProofCheckTransitionResult", () => {
  test("failed transition keeps staged packet entries out of committed packet", () => {
    const staged = createProofCheckPacketStage();
    const result = applyProofCheckTransitionResult({
      state: proofCheckStateForTest(),
      staged,
      transition: transitionForTest("statement:1"),
      transfer: {
        kind: "error",
        diagnostics: [proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT")],
      },
    });

    expect(result.kind).toBe("error");
    expect(staged.entries()).toEqual([]);
    expect(staged.stagedEntries()).toEqual([]);
  });

  test("applying an error result does not mutate state", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:before")] });
    const result = applyProofCheckTransitionResult({
      state,
      staged: createProofCheckPacketStage(),
      transition: transitionForTest("statement:1"),
      transfer: {
        kind: "error",
        diagnostics: [proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT")],
      },
    });

    expect(result.kind).toBe("error");
    expect(result.state).toBe(state);
    expect(proofCheckStateKey(result.state)).toBe(proofCheckStateKey(state));
  });

  test("successful transition stages packet entries without committing them", () => {
    const staged = createProofCheckPacketStage();
    const state = proofCheckStateForTest();
    const result = applyProofCheckTransitionResult({
      state,
      staged,
      transition: transitionForTest("statement:1"),
      transfer: okTransferForTest(),
    });

    expect(result.kind).toBe("ok");
    expect(staged.entries()).toEqual([]);
    expect(staged.stagedEntries()).toHaveLength(1);
    expect(staged.stagedEntries()[0]?.transitionCertificate).toEqual(defaultCertificate);
    expect(staged.stagedEntries()[0]?.anchorStateKey).toBe(proofCheckStateKey(state));
  });

  test("block entry acceptance commits staged packet entries for that block", () => {
    const staged = createProofCheckPacketStage();
    applyProofCheckTransitionResult({
      state: proofCheckStateForTest(),
      staged,
      transition: transitionForTest("statement:1"),
      transfer: okTransferForTest(),
    });

    acceptProofCheckBlockEntryState({ staged, blockId: defaultBlockId });

    expect(staged.stagedEntries()).toEqual([]);
    expect(staged.entries()).toHaveLength(1);
    expect(staged.entries()[0]?.kind).toBe(checkedFactKindId("ownership"));
  });

  test("packet entries generated under a replaced block state can be discarded by stable state key", () => {
    const staged = createProofCheckPacketStage();
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:old")] });
    const stateKey = proofCheckStateKey(state);

    applyProofCheckTransitionResult({
      state,
      staged,
      transition: transitionForTest("statement:1"),
      transfer: okTransferForTest(),
    });

    expect(staged.stagedEntries()).toHaveLength(1);

    discardStagedPacketEntriesForStateKey({ staged, stateKey });

    expect(staged.stagedEntries()).toEqual([]);
    expect(staged.entries()).toEqual([]);
  });

  test("reducer failure keeps state and staged packet entries unchanged", () => {
    const staged = createProofCheckPacketStage();
    const state = proofCheckStateForTest();
    const result = applyProofCheckTransitionResult({
      state,
      staged,
      transition: transitionForTest("statement:1"),
      transfer: okTransferForTest({
        patchEntries: [
          {
            kind: "placeState",
            place: proofMirPlaceId(0),
            state: {
              placeKey: "unknown-place",
              lifecycle: "owned",
            },
          },
        ],
      }),
    });

    expect(result.kind).toBe("error");
    expect(result.state).toBe(state);
    expect(staged.stagedEntries()).toEqual([]);
    expect(staged.entries()).toEqual([]);
  });
});

describe("ProofCheckOperation variants", () => {
  test("operation union covers function entry, MIR points, joins, exits, and terminal closure", () => {
    const operations: ProofCheckOperation[] = [
      { kind: "functionEntry", functionInstanceId: defaultFunctionInstanceId },
      { kind: "statement", statement: proofMirStatementForTest(proofMirStatementId(1)) },
      { kind: "terminator", terminator: proofMirTerminatorForTest(proofMirTerminatorId(1)) },
      {
        kind: "edge",
        edge: proofMirControlEdgeForTest({ edgeId: proofMirControlEdgeId(1) }),
      },
      {
        kind: "call",
        call: proofMirCallGraphEdgeForTest(
          proofMirOwnedCallId(defaultFunctionInstanceId, proofMirCallId(1)),
        ),
      },
      { kind: "join", blockId: proofMirBlockId(2) },
      { kind: "loopHeader", blockId: proofMirBlockId(3) },
      { kind: "exit", exit: proofMirExitEdgeForTest(proofMirExitEdgeId(1)) },
      {
        kind: "terminalClosure",
        terminalKey: checkedTerminalClosureKey("terminal:main"),
      },
    ];

    expect(operations.map((operation) => operation.kind).sort()).toEqual(
      [...PROOF_CHECK_OPERATION_KINDS].sort(),
    );
  });
});
