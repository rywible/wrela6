import { expect, test } from "bun:test";
import { hirExpressionId } from "../../../src/hir/ids";
import { monoExpressionIdFor } from "../../../src/mono/function-instantiator-shell";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionInstance, MonoResolvedCallTarget } from "../../../src/mono/mono-hir";
import { buildMonoResolvedCallTargetTable } from "../../../src/mono/resolved-call-targets";
import type { ReachabilityState } from "../../../src/mono/reachability-shared";

test("resolved call target table uses reachability records instead of scanning inline call metadata", () => {
  const callerInstanceId = monoInstanceId("fn:caller");
  const callExpressionId = monoExpressionIdFor(callerInstanceId, hirExpressionId(7));
  const inlineOnlyTarget: MonoResolvedCallTarget = {
    kind: "sourceFunction",
    targetFunctionInstanceId: monoInstanceId("fn:inline-target"),
  };
  const state = {
    functionInstances: [
      {
        instanceId: callerInstanceId,
        body: {
          statements: [
            {
              kind: {
                kind: "expression",
                expression: {
                  expressionId: callExpressionId,
                  kind: {
                    kind: "call",
                    call: {
                      callee: { expressionId: callExpressionId, kind: { kind: "error" } },
                      resolvedTarget: inlineOnlyTarget,
                      ownerTypeArguments: [],
                      ownerTypeArgumentSource: "none",
                      arguments: [],
                      typeArguments: [],
                    },
                  },
                },
              },
            },
          ],
        },
      } as unknown as MonoFunctionInstance,
    ],
    callResolvedTargets: new Map(),
  } as unknown as ReachabilityState;

  const table = buildMonoResolvedCallTargetTable(state);

  expect(table.entries()).toEqual([]);
});
