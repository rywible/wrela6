import {
  factsForFamily,
  profileHasAll,
  securityFactsWithConstantTime,
  semanticOperationFactsForFamily,
  uniqueFactIds,
} from "./semantic-plugin-helpers";
import type {
  AArch64SemanticPluginInput,
  AArch64SemanticPluginOperationInput,
} from "./semantic-superselector";

export const cryptoMixPlugin = Object.freeze({
  pluginKey: "aes-sha-mix",
  candidatesFor(input: AArch64SemanticPluginInput) {
    return Object.freeze(
      input.operations
        .filter(
          (operation) =>
            operation.kind === "semanticCryptoMix" &&
            cryptoMixContractIsSupported(operation.semanticContract) &&
            operation.vectorPolicy === "ownsVectorState" &&
            profileHasAll(operation, ["FEAT_AES", "FEAT_SHA1", "FEAT_SHA256"]),
        )
        .flatMap((operation) => {
          const semanticFacts = semanticOperationFactsForFamily(operation, "cryptoMix").filter(
            (fact) => fact.payload.contractKey === "aes-sha-round",
          );
          const vectorFacts = factsForFamily(operation, "vector-state").filter(
            (fact) => fact.payload.vectorWidthBits === 128,
          );
          const securityFacts = securityFactsWithConstantTime(operation);
          const keyLifetimeFacts = securityFactsWithAnyLabel(operation, ["noSpill", "wipeOnSpill"]);
          const zeroizationFacts = securityFactsWithAnyLabel(operation, ["zeroizationStore"]);
          const cryptographic = operation.semanticContract.securityContract === "cryptographic";
          if (
            semanticFacts.length === 0 ||
            vectorFacts.length === 0 ||
            securityFacts.length === 0 ||
            (cryptographic && (keyLifetimeFacts.length === 0 || zeroizationFacts.length === 0))
          ) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.aes-sha-mix",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze(["crypto-state"]),
              effects: Object.freeze([]),
              factsUsed: uniqueFactIds(
                semanticFacts,
                vectorFacts,
                securityFacts,
                cryptographic ? keyLifetimeFacts : [],
                cryptographic ? zeroizationFacts : [],
              ),
              securityBehavior: Object.freeze({
                constantTime: true,
                cryptographic,
                preservesKeyLifetime: cryptographic,
                zeroizesKeyMaterial: cryptographic,
              }),
            }),
          ];
        }),
    );
  },
});

function cryptoMixContractIsSupported(contract: Readonly<Record<string, unknown>>): boolean {
  return (
    contract.family === "aes-sha" &&
    contract.roundShape === "aes-sha-round" &&
    contract.mixShape === "block-round" &&
    contract.vectorWidthBits === 128 &&
    (contract.securityContract === "cryptographic" || contract.securityContract === "nonCrypto")
  );
}

function securityFactsWithAnyLabel(
  operation: AArch64SemanticPluginOperationInput,
  labels: readonly string[],
): ReturnType<typeof factsForFamily> {
  return factsForFamily(operation, "security").filter((fact) => {
    const factLabels = Array.isArray(fact.payload.labels) ? fact.payload.labels : [];
    return labels.some((label) => factLabels.includes(label));
  });
}
