import {
  profileHasAll,
  semanticOperationFactsForFamily,
  uniqueFactIds,
} from "./semantic-plugin-helpers";
import type { AArch64SemanticPluginInput } from "./semantic-superselector";

export const checksumFingerprintPlugin = Object.freeze({
  pluginKey: "checksum-crc32",
  candidatesFor(input: AArch64SemanticPluginInput) {
    return Object.freeze(
      input.operations
        .filter(
          (operation) =>
            operation.kind === "semanticChecksum" &&
            checksumContractIsSupported(operation.semanticContract) &&
            profileHasAll(operation, ["FEAT_CRC32"]),
        )
        .flatMap((operation) => {
          const contractKey = checksumContractKey(operation.semanticContract);
          const semanticFacts = semanticOperationFactsForFamily(operation, "checksum").filter(
            (fact) => fact.payload.contractKey === contractKey,
          );
          if (semanticFacts.length === 0) {
            return [];
          }
          return [
            Object.freeze({
              patternId: "semantic.checksum-crc32",
              consumedOperations: Object.freeze([operation.operationId]),
              liveOuts: Object.freeze(["crc"]),
              effects: Object.freeze([]),
              factsUsed: uniqueFactIds(semanticFacts),
            }),
          ];
        }),
    );
  },
});

function checksumContractIsSupported(contract: Readonly<Record<string, unknown>>): boolean {
  return (
    checksumContractKey(contract) !== undefined &&
    contract.widthBits === 32 &&
    (contract.chunkWidthBits === 8 ||
      contract.chunkWidthBits === 16 ||
      contract.chunkWidthBits === 32 ||
      contract.chunkWidthBits === 64) &&
    contract.chunking === "fixed-width" &&
    contract.initialXor === 0 &&
    contract.finalXor === 0
  );
}

function checksumContractKey(contract: Readonly<Record<string, unknown>>): string | undefined {
  if (contract.algorithm === "crc32" && contract.polynomial === "crc32-ieee") {
    return "crc32:crc32-ieee";
  }
  if (contract.algorithm === "crc32c" && contract.polynomial === "crc32c-castagnoli") {
    return "crc32:crc32c-castagnoli";
  }
  return undefined;
}
