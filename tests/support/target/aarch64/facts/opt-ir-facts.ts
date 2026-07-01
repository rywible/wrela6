import {
  optIrFactId,
  optIrFunctionId,
  optIrOperationId,
  optIrRegionId,
  optIrValueId,
  type OptIrOperationId,
  type OptIrValueId,
} from "../../../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../../../src/opt-ir/facts/fact-index";
import { footprintFactRecord } from "../../../../../src/opt-ir/facts/footprint-facts";
import {
  memoryOrderFactRecord,
  regionMemoryTypeFactRecord,
  type OptIrMemoryOrder,
  type OptIrPublicationShape,
  type OptIrRegionMemoryType,
} from "../../../../../src/opt-ir/facts/memory-order-facts";
import {
  securityFactRecord,
  type OptIrSecurityLabel,
} from "../../../../../src/opt-ir/facts/security-facts";
import { fpNumericFactRecord } from "../../../../../src/opt-ir/facts/fp-numeric-facts";
import { semanticOperationFactRecord } from "../../../../../src/opt-ir/facts/semantic-operation-facts";
import {
  vectorStateFactRecord,
  vectorStatePolicyFactRecord,
  type OptIrVectorStatePolicyMode,
} from "../../../../../src/opt-ir/facts/vector-state-facts";

export function aarch64PacketFactSetForTest() {
  return optIrFactSetFromRecords([
    footprintFactRecord({
      factId: optIrFactId(1),
      regionId: optIrRegionId(1),
      start: 0n,
      endExclusive: 32n,
      access: "read",
    }),
  ]);
}

export function aarch64VirtioReleaseFactSetForTest() {
  return aarch64MemoryOrderFactSetForTest({
    operationId: optIrOperationId(9),
    accessKind: "store",
    order: "release",
    publicationShape: "virtioAvailIndexPublication",
    regionId: optIrRegionId(3),
    regionMemoryType: "deviceMmio",
    provenanceKey: "virtio.notify",
  });
}

export function aarch64MemoryOrderFactSetForTest(input: {
  readonly operationId: OptIrOperationId;
  readonly accessKind: "load" | "store" | "readModifyWrite" | "fence";
  readonly order: OptIrMemoryOrder;
  readonly publicationShape?: OptIrPublicationShape;
  readonly regionId?: ReturnType<typeof optIrRegionId>;
  readonly regionMemoryType?: OptIrRegionMemoryType;
  readonly backingRegion?: ReturnType<typeof optIrRegionId>;
  readonly certifiedOffset?: bigint;
  readonly provenanceKey?: string;
}) {
  const records = [
    memoryOrderFactRecord({
      factId: optIrFactId(2),
      operationId: input.operationId,
      accessKind: input.accessKind,
      order: input.order,
      ...(input.publicationShape === undefined ? {} : { publicationShape: input.publicationShape }),
    }),
  ];
  if (input.regionId !== undefined && input.regionMemoryType !== undefined) {
    records.push(
      regionMemoryTypeFactRecord({
        factId: optIrFactId(4),
        regionId: input.regionId,
        memoryType: input.regionMemoryType,
        ...(input.backingRegion === undefined ? {} : { backingRegion: input.backingRegion }),
        ...(input.certifiedOffset === undefined ? {} : { certifiedOffset: input.certifiedOffset }),
        ...(input.provenanceKey === undefined ? {} : { provenanceKey: input.provenanceKey }),
      }),
    );
  }
  return optIrFactSetFromRecords(records);
}

export function aarch64RegionMemoryTypeFactSetForTest(input: {
  readonly regionId: ReturnType<typeof optIrRegionId>;
  readonly memoryType: OptIrRegionMemoryType;
  readonly backingRegion?: ReturnType<typeof optIrRegionId>;
  readonly certifiedOffset?: bigint;
  readonly provenanceKey?: string;
}) {
  return optIrFactSetFromRecords([
    regionMemoryTypeFactRecord({
      factId: optIrFactId(4),
      regionId: input.regionId,
      memoryType: input.memoryType,
      ...(input.backingRegion === undefined ? {} : { backingRegion: input.backingRegion }),
      ...(input.certifiedOffset === undefined ? {} : { certifiedOffset: input.certifiedOffset }),
      ...(input.provenanceKey === undefined ? {} : { provenanceKey: input.provenanceKey }),
    }),
  ]);
}

export function aarch64VectorPolicyFactSetForTest(input: {
  readonly mode: OptIrVectorStatePolicyMode;
}) {
  return optIrFactSetFromRecords([
    vectorStatePolicyFactRecord({
      factId: optIrFactId(5),
      functionId: optIrFunctionId(1),
      mode: input.mode,
      ...(input.mode === "scalarOnly" ? { reason: "fixture-forces-scalar" } : {}),
      ...(input.mode === "ownsVectorState" ? { savePolicy: "callee-saves-owned-state" } : {}),
      ...(input.mode === "callsVectorHelper" ? { helperKey: "fixture.vector.helper" } : {}),
    }),
    vectorStateFactRecord({
      factId: optIrFactId(6),
      operationId: optIrOperationId(8),
      vectorWidthBits: 128,
      laneWidthBits: 8,
      predicate: "allActive",
    }),
  ]);
}

export function aarch64SecretValueFactSetForTest() {
  return aarch64SecurityFactSetForValueForTest({
    valueId: optIrValueId(5),
    labels: ["secret", "noSpill"],
  });
}

export function aarch64SecurityFactSetForValueForTest(input: {
  readonly valueId: OptIrValueId;
  readonly labels: readonly OptIrSecurityLabel[];
}) {
  return optIrFactSetFromRecords([
    securityFactRecord({
      factId: optIrFactId(3),
      valueId: input.valueId,
      labels: input.labels,
    }),
  ]);
}

export function aarch64ChecksumAndPmullSemanticFactSetForTest() {
  return optIrFactSetFromRecords([
    semanticOperationFactRecord({
      factId: optIrFactId(30),
      operationId: optIrOperationId(14),
      family: "checksum",
      contractKey: "crc32:crc32-ieee",
      requiredProfileFeatures: ["FEAT_CRC32"],
    }),
    semanticOperationFactRecord({
      factId: optIrFactId(31),
      operationId: optIrOperationId(15),
      family: "polynomial",
      contractKey: "pmull",
      requiredProfileFeatures: ["FEAT_PMULL"],
    }),
    vectorStateFactRecord({
      factId: optIrFactId(32),
      operationId: optIrOperationId(15),
      vectorWidthBits: 128,
      laneWidthBits: 8,
      predicate: "allActive",
    }),
    footprintFactRecord({
      factId: optIrFactId(33),
      regionId: optIrRegionId(4),
      start: 0n,
      endExclusive: 16n,
      access: "read",
      alignment: 16,
    }),
  ]);
}

export function aarch64ClassifierSemanticFactSetForTest(
  operationIds: readonly OptIrOperationId[] = [optIrOperationId(16)],
) {
  return optIrFactSetFromRecords(
    operationIds.flatMap((operationId, index) => [
      semanticOperationFactRecord({
        factId: optIrFactId(50 + index * 3),
        operationId,
        family: "classifier",
        contractKey: "fixed-u8",
        requiredProfileFeatures: ["FEAT_AdvSIMD", "FEAT_DotProd"],
      }),
      vectorStateFactRecord({
        factId: optIrFactId(51 + index * 3),
        operationId,
        vectorWidthBits: 128,
        laneWidthBits: 8,
        predicate: "allActive",
      }),
      fpNumericFactRecord({
        factId: optIrFactId(52 + index * 3),
        operationId,
        precision: "fp32",
        laneWidthBits: 8,
        signedness: "unsigned",
        accumulation: "widening",
        saturation: "none",
        rounding: "nearestTiesToEven",
        errorBoundUlps: 0,
        numericRange: { min: 0, max: 255 },
      }),
    ]),
  );
}
