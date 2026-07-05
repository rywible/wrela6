import { expect, test } from "bun:test";

import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { functionSignatureSourceTypeClosureProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";

test("W0-05f keeps the mono reachability entry path closing source types deterministically", () => {
  const result = monomorphizeWholeImage({
    program: functionSignatureSourceTypeClosureProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    return;
  }

  const monoProgram = result.program;
  const reachabilityProjection = {
    diagnostics: result.diagnostics,
    functions: monoProgram.functions.entries().map((instance) => String(instance.instanceId)),
    types: monoProgram.types.entries().map((instance) => ({
      instanceId: String(instance.instanceId),
      fieldTypeKinds: instance.fields.map((field) => field.type.kind),
    })),
    graphEdges: monoProgram.instantiationGraph.edges.map((edge) => ({
      sourceKind: edge.source.kind,
      targetInstanceId: String(edge.targetInstanceId),
      targetKind: edge.targetKind,
    })),
  };

  expect(JSON.stringify(reachabilityProjection)).toBe(
    JSON.stringify({
      diagnostics: [],
      functions: ["fn:0|ownerType:none|owner:<>|fn:<>"],
      types: [
        {
          instanceId: "type:40|args:<>",
          fieldTypeKinds: ["source"],
        },
        {
          instanceId: "type:41|args:<>",
          fieldTypeKinds: [],
        },
      ],
      graphEdges: [
        {
          sourceKind: "function",
          targetInstanceId: "type:40|args:<>",
          targetKind: "type",
        },
        {
          sourceKind: "image",
          targetInstanceId: "fn:0|ownerType:none|owner:<>|fn:<>",
          targetKind: "function",
        },
        {
          sourceKind: "type",
          targetInstanceId: "type:41|args:<>",
          targetKind: "type",
        },
      ],
    }),
  );
});
