import {
  factsForFamily,
  profileHasAll,
  securityFactsWithConstantTime,
  semanticOperationFactsForFamily,
  uniqueFactIds,
} from "./semantic-plugin-helpers";
import { selectAArch64DotProductNumeric } from "./fp-selection";
import type { AArch64SemanticPluginInput } from "./semantic-superselector";

export const classifierSelectionPlugin = Object.freeze({
  pluginKey: "classifier-table-dotprod",
  candidatesFor(input: AArch64SemanticPluginInput) {
    return Object.freeze(
      input.operations
        .filter(
          (operation) =>
            operation.kind === "semanticClassifier" &&
            (!operation.secretTableIndex || operation.constantTimeTable) &&
            operation.semanticContract.alphabet === "fixed-u8" &&
            operation.vectorPolicy === "ownsVectorState" &&
            profileHasAll(
              operation,
              profileFeaturesForTableShape(operation.semanticContract.tableShape),
            ),
        )
        .flatMap((operation) => {
          const semanticFacts = semanticOperationFactsForFamily(operation, "classifier");
          const vectorFacts = factsForFamily(operation, "vector-state");
          const fpFacts = factsForFamily(operation, "fp-numeric");
          const securityFacts = operation.secretTableIndex
            ? securityFactsWithConstantTime(operation)
            : [];
          if (semanticFacts.length === 0 || vectorFacts.length === 0) {
            return [];
          }
          const dotProductSelection = requiresDotProduct(operation.semanticContract.tableShape)
            ? selectAArch64DotProductNumeric({
                operationId: operation.operationId,
                factAnswers: fpFacts.map((fact) => ({
                  kind: "yes" as const,
                  factsUsed: Object.freeze([fact.factId]),
                  explanation: Object.freeze([`semantic-plugin-fact:${fact.factId}`]),
                  ...fact.payload,
                })),
                vectorPolicy: operation.vectorPolicy,
                laneWidthBits: numericLaneWidthBits(operation.semanticContract.laneWidthBits),
                signedness: numericSignedness(operation.semanticContract.signedness),
              })
            : undefined;
          if (dotProductSelection?.kind === "rejected") {
            return [];
          }
          if (dotProductSelection === undefined && fpFacts.length === 0) {
            return [];
          }
          if (operation.secretTableIndex && securityFacts.length === 0) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.classifier-table-dotprod",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze(["classifier-score"]),
              effects: Object.freeze([]),
              factsUsed: uniqueFactIds(
                semanticFacts,
                vectorFacts,
                dotProductSelection?.factsUsed ?? fpFacts,
                securityFacts,
              ),
            }),
          ];
        }),
    );
  },
});

function profileFeaturesForTableShape(value: unknown): readonly string[] {
  return value === "dotprod" || value === undefined ? ["FEAT_DotProd"] : ["FEAT_AdvSIMD"];
}

function requiresDotProduct(value: unknown): boolean {
  return value === "dotprod" || value === undefined;
}

function numericLaneWidthBits(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 8;
}

function numericSignedness(value: unknown): "signed" | "unsigned" {
  return value === "signed" ? "signed" : "unsigned";
}
