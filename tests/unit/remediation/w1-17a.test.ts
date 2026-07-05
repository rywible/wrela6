import { expect, test } from "bun:test";

import { imageId } from "../../../src/semantic/ids";
import { functionId } from "../../../src/semantic/ids";
import { canonicalFunctionInstanceId } from "../../../src/mono/instantiation-key";
import { createReachabilityState } from "../../../src/mono/reachability-shared";
import { processRootWorkItem } from "../../../src/mono/reachability/work-items";
import { lookupMonoCallExpression } from "../../../src/mono/reachability/state-table";
import {
  callIntoGenericFunctionProgramForMonoTest,
  errorExpressionBodyProgramForMonoTest,
  unresolvedGenericAtBoundaryProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

test("W1-17a marks shell instantiation errors as failed mono work items", () => {
  const program = unresolvedGenericAtBoundaryProgramForMonoTest();
  const image = program.images.get(imageId(0));
  if (image === undefined) throw new Error("expected test image");
  const state = createReachabilityState({ program, image });
  const instanceId = canonicalFunctionInstanceId({
    functionId: functionId(0),
    ownerTypeArguments: [],
    functionTypeArguments: [],
  });

  processRootWorkItem({
    state,
    item: {
      kind: "function",
      functionId: functionId(0),
      ownerTypeArguments: [],
      functionTypeArguments: [],
    },
  });

  expect(state.functionStates.get(String(instanceId))).toBe("failed");
  expect(state.functionTableLookup.has(String(instanceId))).toBe(false);
});

test("W1-17a marks body instantiation errors as failed mono work items", () => {
  const program = errorExpressionBodyProgramForMonoTest();
  const image = program.images.get(imageId(0));
  if (image === undefined) throw new Error("expected test image");
  const state = createReachabilityState({ program, image });
  const instanceId = canonicalFunctionInstanceId({
    functionId: functionId(0),
    ownerTypeArguments: [],
    functionTypeArguments: [],
  });

  processRootWorkItem({
    state,
    item: {
      kind: "function",
      functionId: functionId(0),
      ownerTypeArguments: [],
      functionTypeArguments: [],
    },
  });

  expect(state.functionStates.get(String(instanceId))).toBe("failed");
  expect(state.functionTableLookup.has(String(instanceId))).toBe(false);
});

test("W1-17a lookup consumers hard-stop on failed mono work entries", () => {
  const program = callIntoGenericFunctionProgramForMonoTest();
  const image = program.images.get(imageId(0));
  if (image === undefined) throw new Error("expected test image");
  const state = createReachabilityState({ program, image });
  const callerDeclaration = program.declarations
    .entries()
    .find((declaration) => declaration.kind === "function" && declaration.name === "caller");
  const callerFunctionId = callerDeclaration?.functionId;
  if (callerFunctionId === undefined) throw new Error("expected caller declaration");
  const callerInstanceId = canonicalFunctionInstanceId({
    functionId: callerFunctionId,
    ownerTypeArguments: [],
    functionTypeArguments: [],
  });

  processRootWorkItem({
    state,
    item: {
      kind: "function",
      functionId: callerFunctionId,
      ownerTypeArguments: [],
      functionTypeArguments: [],
    },
  });

  const caller = state.functionTableLookup.get(String(callerInstanceId));
  if (caller === undefined) throw new Error("expected reachable caller");
  const callExpression = caller.bodyIndex?.expressions
    .entries()
    .find((expression) => expression.kind.kind === "call");
  if (callExpression === undefined) throw new Error("expected call expression");
  state.functionStates.set(String(callerInstanceId), "failed");

  expect(
    lookupMonoCallExpression({
      state,
      callerInstanceId,
      callExpressionId: callExpression.expressionId,
    }),
  ).toBeUndefined();
});
