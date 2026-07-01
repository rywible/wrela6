import {
  factsForFamily,
  semanticOperationFactsForFamily,
  uniqueFactIds,
} from "./semantic-plugin-helpers";
import type { AArch64SemanticPluginInput } from "./semantic-superselector";

export const packetZeroCopyPlugin = Object.freeze({
  pluginKey: "packet-zero-copy",
  candidatesFor(input: AArch64SemanticPluginInput) {
    const operations = input.operations;
    return Object.freeze(
      operations
        .filter((operation) => operation.kind === "semanticRegionMarker")
        .flatMap((operation) => {
          const semanticFacts = semanticOperationFactsForFamily(operation, "regionMarker");
          const footprintFacts = factsForFamily(operation, "footprint");
          if (semanticFacts.length === 0 || footprintFacts.length === 0) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.packet-zero-copy-view",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze(["packet-field"]),
              effects: Object.freeze([]),
              factsUsed: uniqueFactIds(semanticFacts, footprintFacts),
            }),
          ];
        }),
    );
  },
});
