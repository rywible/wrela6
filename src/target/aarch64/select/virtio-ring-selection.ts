import {
  factsForFamily,
  semanticOperationFactsForFamily,
  uniqueFactIds,
} from "./semantic-plugin-helpers";
import type { AArch64SemanticPluginInput } from "./semantic-superselector";

const VIRTIO_PUBLICATION_SHAPES = new Set([
  "virtioAvailIndexPublication",
  "mmioNotification",
  "ringDoorbellPublication",
]);

export const virtioRingSelectionPlugin = Object.freeze({
  pluginKey: "virtio-ring-publish",
  candidatesFor(input: AArch64SemanticPluginInput) {
    return Object.freeze(
      input.operations
        .filter((operation) => operation.kind === "semanticFence")
        .flatMap((operation) => {
          const semanticFacts = semanticOperationFactsForFamily(operation, "fence");
          const memoryFacts = factsForFamily(operation, "memory-order").filter(
            (fact) =>
              fact.packetKind === "memory-order" &&
              VIRTIO_PUBLICATION_SHAPES.has(String(fact.payload.publicationShape)),
          );
          if (semanticFacts.length === 0 || memoryFacts.length === 0) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.virtio-ring-publish",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze([]),
              effects: Object.freeze(["descriptorWrites", "availIndexPublication", "mmioNotify"]),
              factsUsed: uniqueFactIds(semanticFacts, memoryFacts),
            }),
          ];
        }),
    );
  },
});
