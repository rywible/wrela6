import {
  factsForFamily,
  profileHasAll,
  semanticOperationFactsForFamily,
  uniqueFactIds,
} from "./semantic-plugin-helpers";
import type {
  AArch64SemanticPluginInput,
  AArch64SemanticPluginOperationInput,
} from "./semantic-superselector";

export const polynomialPmullPlugin = Object.freeze({
  pluginKey: "polynomial-pmull",
  candidatesFor(input: AArch64SemanticPluginInput) {
    return Object.freeze(
      input.operations
        .filter(
          (operation) =>
            operation.kind === "semanticPolynomial" &&
            pmullContractIsSupported(operation.semanticContract) &&
            operation.vectorPolicy === "ownsVectorState" &&
            profileHasAll(operation, ["FEAT_PMULL"]),
        )
        .flatMap((operation) => {
          const semanticFacts = semanticOperationFactsForFamily(operation, "polynomial").filter(
            (fact) => fact.payload.contractKey === "pmull",
          );
          const vectorFacts = factsForFamily(operation, "vector-state").filter(
            (fact) => fact.payload.vectorWidthBits === 128,
          );
          const footprintFacts = footprintFactsForContract(operation);
          if (
            semanticFacts.length === 0 ||
            vectorFacts.length === 0 ||
            footprintFacts.length === 0
          ) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.polynomial-pmull",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze(["pmull-result"]),
              effects: Object.freeze([]),
              factsUsed: uniqueFactIds(semanticFacts, vectorFacts, footprintFacts),
            }),
          ];
        }),
    );
  },
});

function pmullContractIsSupported(contract: Readonly<Record<string, unknown>>): boolean {
  return (
    contract.polynomial === "pmull" &&
    contract.chunkWidthBits === 64 &&
    contract.reductionShape === "carryless-multiply" &&
    Number.isInteger(contract.alignmentBytes) &&
    Number(contract.alignmentBytes) >= 16 &&
    contractRegion(contract) !== undefined
  );
}

function footprintFactsForContract(
  operation: AArch64SemanticPluginOperationInput,
): ReturnType<typeof factsForFamily> {
  const region = contractRegion(operation.semanticContract);
  const alignmentBytes = Number(operation.semanticContract.alignmentBytes);
  if (region === undefined || !Number.isInteger(alignmentBytes)) {
    return [];
  }
  return factsForFamily(operation, "footprint").filter(
    (fact) =>
      fact.subjectKey === `region:${region}` &&
      Number(fact.payload.alignment ?? 1) >= alignmentBytes,
  );
}

function contractRegion(contract: Readonly<Record<string, unknown>>): number | undefined {
  if (Number.isInteger(contract.footprintRegion)) return Number(contract.footprintRegion);
  if (Number.isInteger(contract.regionId)) return Number(contract.regionId);
  if (Number.isInteger(contract.region)) return Number(contract.region);
  return undefined;
}
