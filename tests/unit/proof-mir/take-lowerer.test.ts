import { describe, expect, test } from "bun:test";
import {
  brandId,
  hirExpressionId,
  hirLocalId,
  hirStatementId,
  obligationId,
  resourcePlaceId,
  sessionId,
} from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoExpression,
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoObligation,
  MonoResourcePlace,
  MonoStatement,
  MonoStatementId,
  MonoTakeStatement,
  MonoTerminalCall,
  MonomorphizedHirProgram,
} from "../../../src/mono/mono-hir";
import {
  monoExpressionIdFor,
  monoStatementIdFor,
} from "../../../src/mono/function-instantiator-shell";
import { buildMonoTable, proofMetadataIdKey } from "../../../src/mono/proof-metadata-tables";
import type { ObligationId, SessionId, BrandId } from "../../../src/hir/ids";
import type { ProofMirExpressionLowerer } from "../../../src/proof-mir/lower/lowering-context";
import {
  lowerProofMirTakeForTest,
  lowerProofMirTakeSequenceForTest,
  type TakeLowererFixture,
} from "../../support/proof-mir/lower-harness/take-lowerer-harness";

const functionInstanceId = monoInstanceId("fn:main");

function statementId(ordinal: number): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function expressionId(ordinal: number): MonoExpressionId {
  return monoExpressionIdFor(functionInstanceId, hirExpressionId(ordinal));
}

function proofId<IdValue>(ordinal: number): MonoInstantiatedProofId<IdValue> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: ordinal as IdValue,
    instanceId: functionInstanceId,
  };
}

function monoLocalPlace(localOrdinal: number): MonoResourcePlace {
  const localId = instantiatedHirId(functionInstanceId, hirLocalId(localOrdinal));
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(localOrdinal),
      instanceId: functionInstanceId,
    },
    canonicalKey: `function:main/root:local:${localOrdinal}`,
    root: { kind: "local", localId },
    projection: [],
    type: { kind: "core", coreTypeId: "u8" } as never,
    resourceKind: "Affine",
    sourceOrigin: `source:place:${localOrdinal}`,
    kind: "local",
    localId,
  };
}

function literalExpression(ordinal: number): MonoExpression {
  return {
    expressionId: expressionId(ordinal),
    kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
    type: { kind: "core", coreTypeId: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:expr:${ordinal}`,
  };
}

function aliasLocal(ordinal: number, name: string): MonoLocal {
  const localId = instantiatedHirId(functionInstanceId, hirLocalId(ordinal));
  return {
    localId,
    name,
    type: { kind: "core", coreTypeId: "u8" } as never,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "takeAlias",
    sourceOrigin: `source:local:${name}`,
  };
}

function streamTakeStatement(input: {
  readonly statementOrdinal: number;
  readonly body?: readonly MonoStatement[];
  readonly aliasLocal?: MonoLocal;
}): MonoTakeStatement {
  const sessionProofId = proofId<SessionId>(1);
  const brandProofId = proofId<BrandId>(2);
  const closureObligationId = proofId<ObligationId>(3);
  return {
    operand: {
      kind: "place",
      place: monoLocalPlace(10),
      expression: literalExpression(input.statementOrdinal * 10),
    },
    takeKind: {
      kind: "stream",
      sessionId: sessionProofId,
      itemBrandId: brandProofId,
      closureObligationId,
      itemType: { kind: "core", coreTypeId: "u8" } as never,
      itemResourceKind: "Affine",
    },
    ...(input.aliasLocal === undefined ? {} : { aliasLocal: input.aliasLocal }),
    body: {
      statements: input.body ?? [],
      sourceOrigin: `source:take:${input.statementOrdinal}`,
    },
    sourceOrigin: `source:stmt:take:${input.statementOrdinal}`,
  };
}

function bufferTakeStatement(input: {
  readonly statementOrdinal: number;
  readonly body?: readonly MonoStatement[];
}): MonoTakeStatement {
  const bufferObligationId = proofId<ObligationId>(4);
  return {
    operand: {
      kind: "place",
      place: monoLocalPlace(11),
      expression: literalExpression(input.statementOrdinal * 10 + 1),
    },
    takeKind: {
      kind: "buffer",
      bufferPlace: monoLocalPlace(11),
      obligationId: bufferObligationId,
    },
    body: {
      statements: input.body ?? [],
      sourceOrigin: `source:take:${input.statementOrdinal}`,
    },
    sourceOrigin: `source:stmt:take:${input.statementOrdinal}`,
  };
}

function streamClosureObligation(
  closureObligationId: MonoInstantiatedProofId<ObligationId>,
): MonoObligation {
  return {
    obligationId: closureObligationId,
    kind: "streamClosure",
    sourceOrigin: "source:obligation:stream-closure",
  };
}

function bufferDischargeObligation(
  obligationIdValue: MonoInstantiatedProofId<ObligationId>,
): MonoObligation {
  return {
    obligationId: obligationIdValue,
    kind: "bufferDischarge",
    sourceOrigin: "source:obligation:buffer-discharge",
    place: monoLocalPlace(11),
  };
}

function programWithProofMetadata(input: {
  readonly obligations?: readonly MonoObligation[];
  readonly terminalCalls?: readonly MonoTerminalCall[];
}): MonomorphizedHirProgram {
  const obligations = input.obligations ?? [];
  const terminalCalls = input.terminalCalls ?? [];
  return {
    proofMetadata: {
      obligations: buildMonoTable(
        obligations,
        (entry) => proofMetadataIdKey(entry.obligationId),
        (id: MonoInstantiatedProofId<unknown>) => proofMetadataIdKey(id),
      ),
      terminalCalls: buildMonoTable(
        terminalCalls,
        (entry) => proofMetadataIdKey(entry.terminalCallId),
        (id: MonoInstantiatedProofId<unknown>) => proofMetadataIdKey(id),
      ),
      sessions: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      brands: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      resourcePlaces: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      callSiteRequirements: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      validations: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      attempts: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      privateStateTransitions: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      factOrigins: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      platformContractEdges: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
      imageOrigins: buildMonoTable(
        [],
        () => "",
        () => "",
      ),
    },
    functions: { entries: () => [], get: () => undefined },
  } as unknown as MonomorphizedHirProgram;
}

const expressionLowererForTakeTest: ProofMirExpressionLowerer = {
  lowerExpression: (_input) => ({
    kind: "ok",
    value: {
      kind: "valueAndPlace",
      value: "value:take-operand" as never,
      place: "place:take-operand" as never,
    },
  }),
  lowerExpressionAsPlace: (_input) => ({
    kind: "ok",
    value: { kind: "place", place: "place:take-operand" as never },
  }),
};

function takeLowererFixture(): TakeLowererFixture {
  const take = streamTakeStatement({ statementOrdinal: 1 });
  const closureObligationId =
    take.takeKind.kind === "stream" ? take.takeKind.closureObligationId : proofId<ObligationId>(0);
  return {
    functionInstanceId,
    takeStatement: take,
    monoStatement: {
      statementId: statementId(1),
      kind: { kind: "take", statement: take },
      sourceOrigin: take.sourceOrigin,
    },
    program: programWithProofMetadata({
      obligations: [streamClosureObligation(closureObligationId)],
    }),
    locals: [],
    expression: expressionLowererForTakeTest,
  };
}

describe("ProofMirTakeLowerer", () => {
  test("take lowering records session member separately from obligation", () => {
    const lowered = lowerProofMirTakeForTest(takeLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.statements.map((statement) => statement.kind.kind)).toContain(
      "openSessionMember",
    );
    expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("openObligation");
  });

  test("take lowering evaluates operand and records take start with closure obligation", () => {
    const lowered = lowerProofMirTakeForTest(takeLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.operandEvaluated).toBe(true);
    expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("take");
    const takeStatement = lowered.statements.find((statement) => statement.kind.kind === "take");
    expect(takeStatement?.kind).toMatchObject({
      kind: "take",
      take: expect.objectContaining({
        obligation: expect.objectContaining({
          obligationId: expect.objectContaining({ hirId: obligationId(3) }),
        }),
      }),
    });
  });

  test("stream take opens session member with session, brand, obligation, place, and origin", () => {
    const lowered = lowerProofMirTakeForTest(takeLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    const sessionMember = lowered.statements.find(
      (statement) => statement.kind.kind === "openSessionMember",
    );
    expect(sessionMember?.kind).toMatchObject({
      kind: "openSessionMember",
      member: expect.objectContaining({
        sessionId: expect.objectContaining({ hirId: sessionId(1) }),
        brandId: expect.objectContaining({ hirId: brandId(2) }),
        obligationId: expect.objectContaining({ hirId: obligationId(3) }),
        placeKey: expect.any(String),
        originKey: expect.any(String),
      }),
    });
  });

  test("take alias locals bind to place-backed storage when present", () => {
    const alias = aliasLocal(5, "event");
    const take = streamTakeStatement({ statementOrdinal: 2, aliasLocal: alias });
    const lowered = lowerProofMirTakeForTest({
      ...takeLowererFixture(),
      takeStatement: take,
      locals: [alias],
      monoStatement: {
        statementId: statementId(2),
        kind: { kind: "take", statement: take },
        sourceOrigin: take.sourceOrigin,
      },
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.aliasStorage).toBe("placeBacked");
    const takeStart = lowered.statements.find((statement) => statement.kind.kind === "take");
    expect(takeStart?.kind).toMatchObject({
      kind: "take",
      take: expect.objectContaining({
        aliasMonoLocalId: alias.localId,
      }),
    });
  });

  test("take body exits emit scope-exit edges with crossed scopes and allowed transfers", () => {
    const lowered = lowerProofMirTakeForTest(takeLowererFixture());

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.exits.length).toBeGreaterThan(0);
    expect(lowered.exits[0]).toMatchObject({
      closure: expect.objectContaining({
        kind: "scopeExit",
        evaluateAfterEdgeEffects: true,
      }),
    });
    expect(lowered.exits[0]?.crossedScopes.length).toBeGreaterThan(0);
    expect(lowered.exits[0]?.allowedTransfers.length).toBeGreaterThan(0);
  });

  test("repeated take exits use site-discriminated exit keys", () => {
    const firstTake = streamTakeStatement({ statementOrdinal: 5 });
    const secondTake = streamTakeStatement({ statementOrdinal: 6 });
    const lowered = lowerProofMirTakeSequenceForTest({
      functionInstanceId,
      takeStatements: [firstTake, secondTake],
      monoStatements: [
        {
          statementId: statementId(5),
          kind: { kind: "take", statement: firstTake },
          sourceOrigin: firstTake.sourceOrigin,
        },
        {
          statementId: statementId(6),
          kind: { kind: "take", statement: secondTake },
          sourceOrigin: secondTake.sourceOrigin,
        },
      ],
      program: programWithProofMetadata({
        obligations: [streamClosureObligation(proofId<ObligationId>(3))],
      }),
      locals: [],
      expression: expressionLowererForTakeTest,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.exits).toHaveLength(2);
    const exitKeys = lowered.exits.map((exit) => String(exit.exitKey));
    expect(new Set(exitKeys).size).toBe(2);
    expect(exitKeys.every((exitKey) => exitKey.includes("take.exit"))).toBe(true);
  });

  test("close and discharge statements come only from mono proof metadata sites", () => {
    const take = bufferTakeStatement({ statementOrdinal: 3 });
    const bufferObligationId =
      take.takeKind.kind === "buffer" ? take.takeKind.obligationId : proofId<ObligationId>(0);

    const withMetadata = lowerProofMirTakeForTest({
      functionInstanceId,
      takeStatement: take,
      monoStatement: {
        statementId: statementId(3),
        kind: { kind: "take", statement: take },
        sourceOrigin: take.sourceOrigin,
      },
      program: programWithProofMetadata({
        obligations: [bufferDischargeObligation(bufferObligationId)],
      }),
      locals: [],
      expression: expressionLowererForTakeTest,
    });
    const withoutMetadata = lowerProofMirTakeForTest({
      functionInstanceId,
      takeStatement: take,
      monoStatement: {
        statementId: statementId(3),
        kind: { kind: "take", statement: take },
        sourceOrigin: take.sourceOrigin,
      },
      program: programWithProofMetadata({ obligations: [] }),
      locals: [],
      expression: expressionLowererForTakeTest,
    });

    expect(withMetadata.kind).toBe("ok");
    expect(withoutMetadata.kind).toBe("ok");
    if (withMetadata.kind !== "ok" || withoutMetadata.kind !== "ok") return;

    expect(withMetadata.statements.map((statement) => statement.kind.kind)).toContain(
      "dischargeObligation",
    );
    expect(withoutMetadata.statements.map((statement) => statement.kind.kind)).not.toContain(
      "dischargeObligation",
    );
    expect(withoutMetadata.statements.map((statement) => statement.kind.kind)).not.toContain(
      "closeSessionMember",
    );
  });

  test("buffer take opens obligation without session member", () => {
    const take = bufferTakeStatement({ statementOrdinal: 4 });
    const bufferObligationId =
      take.takeKind.kind === "buffer" ? take.takeKind.obligationId : proofId<ObligationId>(0);
    const lowered = lowerProofMirTakeForTest({
      functionInstanceId,
      takeStatement: take,
      monoStatement: {
        statementId: statementId(4),
        kind: { kind: "take", statement: take },
        sourceOrigin: take.sourceOrigin,
      },
      program: programWithProofMetadata({
        obligations: [bufferDischargeObligation(bufferObligationId)],
      }),
      locals: [],
      expression: expressionLowererForTakeTest,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("openObligation");
    expect(lowered.statements.map((statement) => statement.kind.kind)).not.toContain(
      "openSessionMember",
    );
  });
});
