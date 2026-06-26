import { expect, test } from "bun:test";
import { composeCallProofMetadata } from "../../../src/hir/call-proof-metadata";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import {
  certifiedPlatformBindingFake,
  successfulCallFake,
  terminalSurfaceFake,
} from "../../support/hir/typed-hir-fakes";
import { functionId } from "../../../src/semantic/ids";

test("certified platform call carries contract edge", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  composeCallProofMetadata({
    call: successfulCallFake({ calleeFunctionId: functionId(0) }),
    context,
    sourceRequirements: [],
    platformBinding: certifiedPlatformBindingFake({ primitiveName: "exit" }),
  });

  expect(context.proofMetadata.platformContractEdges.entries()).toHaveLength(1);
});

test("certified platform call registers edge in caller call lookup", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const binding = certifiedPlatformBindingFake({ primitiveName: "exit" });
  const call = successfulCallFake({ calleeFunctionId: binding.functionId });
  composeCallProofMetadata({
    call,
    callExpressionId: call.callee.expressionId,
    context,
    sourceRequirements: [],
    platformBinding: binding,
  });

  const edges = context.proofMetadata.platformContractEdgesByCall.get({
    owner: { kind: "function", functionId: functionId(0) },
    callExpressionId: call.callee.expressionId,
    calleeFunctionId: binding.functionId,
  });
  expect(edges).toHaveLength(1);
});

test("terminal call creates terminal obligation", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  composeCallProofMetadata({
    call: successfulCallFake({ calleeFunctionId: functionId(2) }),
    context,
    sourceRequirements: [],
    terminalSurface: terminalSurfaceFake({ functionId: functionId(2) }),
  });

  expect(context.proofMetadata.terminalCalls.entries()).toHaveLength(1);
  expect(
    context.proofMetadata.obligations.entries().map((obligation) => obligation.kind),
  ).toContain("terminalClosure");
});
