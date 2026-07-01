import { factsForFamily, uniqueFactIds } from "./semantic-plugin-helpers";
import type { AArch64SemanticPluginInput } from "./semantic-superselector";

export const tailProofSelectionPlugin = Object.freeze({
  pluginKey: "vector-tail-free",
  candidatesFor(input: AArch64SemanticPluginInput) {
    return Object.freeze(
      input.operations
        .filter((operation) => operation.kind === "vectorLoad")
        .flatMap((operation) => {
          const footprintFacts = factsForFamily(operation, "footprint");
          const vectorFacts = factsForFamily(operation, "vector-state");
          if (footprintFacts.length === 0 || vectorFacts.length === 0) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.vector-tail-free",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze(["vector-body"]),
              effects: Object.freeze([]),
              factsUsed: uniqueFactIds(footprintFacts, vectorFacts),
            }),
          ];
        }),
    );
  },
});
