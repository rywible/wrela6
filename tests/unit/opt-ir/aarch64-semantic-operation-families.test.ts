import { describe, expect, test } from "bun:test";
import { optIrOperationId, optIrOriginId, optIrValueId } from "../../../src/opt-ir/ids";
import {
  optIrSemanticChecksumOperation,
  optIrSemanticCryptoMixOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrOperationSchemaForKind } from "../../../src/opt-ir/operation-schema";

describe("AArch64 semantic OptIR operation families", () => {
  test("AES and SHA forms require named semantic operations instead of integer idioms", () => {
    const operation = optIrSemanticCryptoMixOperation({
      operationId: optIrOperationId(1),
      operands: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(3)],
      resultTypes: [optIrUnsignedIntegerType(32)],
      semanticContract: {
        family: "sha256Round",
        securityBehavior: "constantTime",
        keyLifetime: "notKeyMaterial",
      },
      originId: optIrOriginId(1),
    });

    expect(String(operation.semantics.interpreterRule)).toBe("semantic-crypto-mix");
    expect(operation.effects.isRuntimePure).toBe(true);
    if (operation.kind !== "semanticCryptoMix") {
      throw new Error("expected semantic crypto mix operation");
    }
    expect(operation.semanticContract.family).toBe("sha256Round");
  });

  test("checksum operations carry schema-derived metadata", () => {
    const operation = optIrSemanticChecksumOperation({
      operationId: optIrOperationId(2),
      operands: [optIrValueId(4)],
      resultIds: [optIrValueId(5)],
      resultTypes: [optIrUnsignedIntegerType(32)],
      semanticContract: { family: "crc32c", polynomial: "castagnoli" },
      originId: optIrOriginId(2),
    });

    expect(operation.kind).toBe("semanticChecksum");
    expect(optIrOperationSchemaForKind("semanticChecksum").family).toBe("effectful");
  });
});
