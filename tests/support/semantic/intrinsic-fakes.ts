import { intrinsicId, type IntrinsicId } from "../../../src/semantic/ids";
import type {
  IntrinsicCatalog,
  IntrinsicFunctionDeclarationSpec,
} from "../../../src/semantic/item-index/intrinsic-catalog";

const testType = { name: ["U8"], arguments: [] } as const;

export function intrinsicFunctionFake(
  name: string,
  identifier: IntrinsicId = intrinsicId(`intrinsics.test.${name}`),
): IntrinsicFunctionDeclarationSpec {
  return {
    kind: "function",
    intrinsicId: identifier,
    name,
    signature: {
      typeParameters: [],
      parameters: [{ name: "value", type: testType, isConsumed: false }],
      returnType: testType,
    },
    targetAvailability: { targets: ["test"] },
    proofContract: { requiredFacts: [], consumedCapabilities: [], producedCapabilities: [] },
    lowering: { backend: "test", operation: name, attributes: {} },
  };
}

export function intrinsicCatalogFake(names: readonly string[]): IntrinsicCatalog {
  return {
    modules: [
      {
        pathKey: "intrinsics/test.wr",
        display: "intrinsics/test.wr",
        declarations: names.map((name) => intrinsicFunctionFake(name)),
      },
    ],
  };
}
