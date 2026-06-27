import { describe, expect, test } from "bun:test";
import { hirExpressionId } from "../../../src/hir/ids";
import type { HirTerminalCallId, ObligationId } from "../../../src/hir/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoExpression,
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoTerminalCall,
  MonomorphizedHirProgram,
} from "../../../src/mono/mono-hir";
import { monoExpressionIdFor } from "../../../src/mono/function-instantiator-shell";
import { buildMonoTable, proofMetadataIdKey } from "../../../src/mono/proof-metadata-tables";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import type { ProofMirExpressionLowerer } from "../../../src/proof-mir/lower/lowering-context";
import {
  lowerProofMirReachableMonoErrorForTest,
  lowerProofMirReturnForTest,
  lowerProofMirTerminalPanicForTest,
  recordProofMirTerminalCallForTest,
} from "../../support/proof-mir/lower-harness/terminal-lowerer-harness";
import { functionId } from "../../../src/semantic/ids";

const functionInstanceId = monoInstanceId("fn:main");

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

function programWithTerminalCall(terminalCall: MonoTerminalCall): MonomorphizedHirProgram {
  return {
    proofMetadata: {
      terminalCalls: buildMonoTable(
        [terminalCall],
        (entry) => proofMetadataIdKey(entry.terminalCallId),
        (id: MonoInstantiatedProofId<unknown>) => proofMetadataIdKey(id),
      ),
      obligations: buildMonoTable(
        [],
        () => "",
        () => "",
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

function terminalCallFixture(): {
  readonly terminalCall: MonoTerminalCall;
  readonly callExpressionId: MonoExpressionId;
  readonly program: MonomorphizedHirProgram;
} {
  const callExpressionId = expressionId(1);
  const terminalCall: MonoTerminalCall = {
    terminalCallId: proofId<HirTerminalCallId>(1),
    callExpressionId,
    calleeFunctionId: functionId(1),
    closureObligationId: proofId<ObligationId>(2),
    sourceOrigin: "source:terminal-call:1",
  };
  return {
    terminalCall,
    callExpressionId,
    program: programWithTerminalCall(terminalCall),
  };
}

const expressionLowererForTerminalTest: ProofMirExpressionLowerer = {
  lowerExpression: () => ({
    kind: "ok",
    value: { kind: "value", value: "value:return:1" as never },
  }),
  lowerExpressionAsPlace: () => ({
    kind: "error",
    diagnostics: [],
  }),
};

describe("ProofMirTerminalLowerer", () => {
  test("ordinary return creates explicit function exit policy", () => {
    const lowered = lowerProofMirReturnForTest({
      functionInstanceId,
      terminal: false,
      expression: {
        expressionId: 0 as never,
        kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
        type: { kind: "core", coreTypeId: "u8" } as never,
        resourceKind: "Copy",
        sourceOrigin: "source:return:1",
      } satisfies MonoExpression,
      expressionLowerer: expressionLowererForTerminalTest,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.terminator?.kind).toBe("return");
    expect(lowered.returnEdge?.kind).toBe("returnExit");
    expect(lowered.exits).toContainEqual(
      expect.objectContaining({
        kind: "ordinaryReturn",
        boundary: { kind: "function", unwind: "none" },
        closure: expect.objectContaining({
          kind: "functionExit",
          terminalReachability: "notRequired",
        }),
      }),
    );
  });

  test("terminal return uses terminal closure policy with required reachability", () => {
    const lowered = lowerProofMirReturnForTest({
      functionInstanceId,
      terminal: true,
      expression: undefined,
      expressionLowerer: expressionLowererForTerminalTest,
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.exits).toContainEqual(
      expect.objectContaining({
        kind: "terminalReturn",
        closure: expect.objectContaining({
          kind: "functionExit",
          terminalReachability: "required",
        }),
      }),
    );
  });

  test("terminal call preserves mono terminal call and closure obligation ids", () => {
    const fixture = terminalCallFixture();
    const recorded = recordProofMirTerminalCallForTest({
      functionInstanceId,
      program: fixture.program,
      terminalCall: fixture.terminalCall,
      callExpressionId: fixture.callExpressionId,
    });

    expect(recorded.kind).toBe("ok");
    if (recorded.kind !== "ok") return;
    expect(recorded.value.terminalCallId).toEqual(fixture.terminalCall.terminalCallId);
    expect(recorded.value.closureObligationId).toEqual(fixture.terminalCall.closureObligationId);
    expect(recorded.value.factKey).toBeTruthy();
  });

  test("panic lowering creates panic terminator and panicExit edge", () => {
    const lowered = lowerProofMirTerminalPanicForTest({
      functionInstanceId,
      reason: "runtime abort",
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.terminator?.kind).toBe("panic");
    expect(lowered.returnEdge?.kind).toBe("panicExit");
    expect(lowered.exits).toContainEqual(
      expect.objectContaining({
        kind: "panic",
        boundary: { kind: "function", unwind: "none" },
      }),
    );
  });

  test("reachable mono error statement returns PROOF_MIR_REACHABLE_MONO_ERROR", () => {
    const lowered = lowerProofMirReachableMonoErrorForTest({
      functionInstanceId,
      reason: "unreachable recovery path",
    });

    expect(lowered.kind).toBe("error");
    expect(lowered.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      proofMirDiagnosticCode("PROOF_MIR_REACHABLE_MONO_ERROR"),
    ]);
  });
});
