import { describe, expect, test } from "bun:test";

import {
  createOptIrSubjectRemapTable,
  optIrFactSubjectKey,
  requireRemappedOptIrFactSubject,
  remapOptionalOptIrFactSubject,
  type OptIrFactSubject,
} from "../../../src/opt-ir/facts/subject-remapping";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFactId,
  optIrOperationId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";

describe("subject remap", () => {
  test("remaps every optimization subject kind and records dropped subjects", () => {
    const sourceValue = valueSubject(1);
    const sourceOperation = operationSubject(2);
    const sourceBlock = blockSubject(3);
    const sourceEdge = edgeSubject(4);
    const sourceRegion = regionSubject(5);
    const sourceFact = factSubject(6);
    const dropped = valueSubject(99);

    const table = createOptIrSubjectRemapTable({
      values: [[optIrValueId(1), optIrValueId(11)]],
      operations: [[optIrOperationId(2), optIrOperationId(12)]],
      blocks: [[optIrBlockId(3), optIrBlockId(13)]],
      edges: [[optIrEdgeId(4), optIrEdgeId(14)]],
      regions: [[optIrRegionId(5), optIrRegionId(15)]],
      facts: [[optIrFactId(6), optIrFactId(16)]],
      droppedSubjects: [dropped],
    });

    expect(requireRemappedOptIrFactSubject(table, sourceValue)).toEqual(valueSubject(11));
    expect(requireRemappedOptIrFactSubject(table, sourceOperation)).toEqual(operationSubject(12));
    expect(requireRemappedOptIrFactSubject(table, sourceBlock)).toEqual(blockSubject(13));
    expect(requireRemappedOptIrFactSubject(table, sourceEdge)).toEqual(edgeSubject(14));
    expect(requireRemappedOptIrFactSubject(table, sourceRegion)).toEqual(regionSubject(15));
    expect(requireRemappedOptIrFactSubject(table, sourceFact)).toEqual(factSubject(16));
    expect(table.droppedSubjectKeys).toEqual([optIrFactSubjectKey(dropped)]);
  });

  test("returns identity for optional missing remaps and fails closed for required remaps", () => {
    const source = valueSubject(8);
    const table = createOptIrSubjectRemapTable({});

    expect(remapOptionalOptIrFactSubject(table, source)).toEqual(source);
    expect(() => requireRemappedOptIrFactSubject(table, source)).toThrow(
      "Missing required OptIR subject remap for value:8.",
    );
  });

  test("builds deterministic immutable remap snapshots", () => {
    const input: {
      values: [OptIrValueIdPair, OptIrValueIdPair];
      droppedSubjects: [OptIrFactSubject, OptIrFactSubject];
    } = {
      values: [
        [optIrValueId(9), optIrValueId(19)],
        [optIrValueId(1), optIrValueId(11)],
      ],
      droppedSubjects: [valueSubject(2), edgeSubject(3)],
    };

    const table = createOptIrSubjectRemapTable(input);

    expect(table.entries).toEqual([
      { from: valueSubject(1), to: valueSubject(11) },
      { from: valueSubject(9), to: valueSubject(19) },
    ]);
    expect(table.droppedSubjectKeys).toEqual(["edge:3", "value:2"]);

    expect(() => {
      (table.entries as { from: OptIrFactSubject; to: OptIrFactSubject }[]).push({
        from: valueSubject(40),
        to: valueSubject(41),
      });
    }).toThrow();
    expect(table.entries).toHaveLength(2);

    input.values[0] = [optIrValueId(20), optIrValueId(21)];
    expect(requireRemappedOptIrFactSubject(table, valueSubject(9))).toEqual(valueSubject(19));
  });

  test("does not let required remaps preserve dropped subjects", () => {
    const dropped = factSubject(7);
    const table = createOptIrSubjectRemapTable({
      droppedSubjects: [dropped],
    });

    expect(remapOptionalOptIrFactSubject(table, dropped)).toEqual(dropped);
    expect(() => requireRemappedOptIrFactSubject(table, dropped)).toThrow(
      "OptIR subject fact:7 was explicitly dropped.",
    );
  });
});

function valueSubject(value: number): OptIrFactSubject {
  return { kind: "value", valueId: optIrValueId(value) };
}

function operationSubject(value: number): OptIrFactSubject {
  return { kind: "operation", operationId: optIrOperationId(value) };
}

function blockSubject(value: number): OptIrFactSubject {
  return { kind: "block", blockId: optIrBlockId(value) };
}

function edgeSubject(value: number): OptIrFactSubject {
  return { kind: "edge", edgeId: optIrEdgeId(value) };
}

function regionSubject(value: number): OptIrFactSubject {
  return { kind: "region", regionId: optIrRegionId(value) };
}

function factSubject(value: number): OptIrFactSubject {
  return { kind: "fact", factId: optIrFactId(value) };
}

type OptIrValueIdPair = readonly [ReturnType<typeof optIrValueId>, ReturnType<typeof optIrValueId>];
