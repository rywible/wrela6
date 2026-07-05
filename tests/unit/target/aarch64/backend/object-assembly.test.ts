import { describe, expect, test } from "bun:test";

import {
  annotateAArch64ByteProvenance,
  aarch64ObjectSecurityInputFromFacts,
} from "../../../../../src/target/aarch64/backend/api/object-assembly";
import { importAArch64BackendFacts } from "../../../../../src/target/aarch64/backend/facts/backend-fact-import";
import { verifyAArch64SecurityLabelConservation } from "../../../../../src/target/aarch64/backend/facts/security-label-conservation";
import { aarch64ObjectByteProvenance } from "../../../../../src/target/aarch64/backend/object/object-module";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineFactId } from "../../../../../src/target/aarch64/machine-ir/ids";

describe("AArch64 object assembly helpers", () => {
  test("byte provenance fact matching is exact and does not collide by prefix", () => {
    const imported = importAArch64BackendFacts({
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: ["target.security"],
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(1),
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 10 },
            payload: { label: "key" },
            upstreamVerifierKey: "proof.security",
            targetDeclarationKeys: ["target.security"],
          }),
        ],
      }),
    });
    expect(imported.kind).toBe("ok");
    if (imported.kind !== "ok") throw new Error("expected fact import success");

    const [record] = annotateAArch64ByteProvenance(
      [
        aarch64ObjectByteProvenance({
          stableKey: "byte:vreg:1",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
          source: "vreg:1",
        }),
      ],
      imported.factIndex,
    );

    expect(record?.factFamilies).toEqual([]);
    expect(record?.machineSubjectKey).toBeUndefined();
  });

  test("untyped byte provenance does not match typed fact subjects by suffix", () => {
    const imported = importAArch64BackendFacts({
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: ["target.security"],
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(2),
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 1 },
            payload: { label: "key" },
            upstreamVerifierKey: "proof.security",
            targetDeclarationKeys: ["target.security"],
          }),
        ],
      }),
    });
    expect(imported.kind).toBe("ok");
    if (imported.kind !== "ok") throw new Error("expected fact import success");

    const [record] = annotateAArch64ByteProvenance(
      [
        aarch64ObjectByteProvenance({
          stableKey: "byte:untyped",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
          source: "1",
        }),
      ],
      imported.factIndex,
    );

    expect(record?.factFamilies).toEqual([]);
    expect(record?.machineSubjectKey).toBeUndefined();
  });

  test("wipe labels come from spill placements rather than existing wipe events", () => {
    const imported = importAArch64BackendFacts({
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: ["target.security"],
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(3),
            extensionKey: "security.wipe-on-spill",
            subject: { kind: "virtualRegister", vreg: 7 },
            payload: { label: "key" },
            upstreamVerifierKey: "proof.security",
            targetDeclarationKeys: ["target.security"],
          }),
        ],
      }),
    });
    expect(imported.kind).toBe("ok");
    if (imported.kind !== "ok") throw new Error("expected fact import success");

    const securityInput = aarch64ObjectSecurityInputFromFacts(imported.factIndex, [
      {
        functionKey: "secure.exit",
        allocationPlan: [],
        securityPlacements: [
          {
            subjectKey: "vreg:7",
            locationKind: "spill-slot",
            locationKey: "spill-slot:vreg:7",
          },
        ],
        securityWipes: [
          {
            subjectKey: "vreg:7",
            slotKey: "spill-slot:vreg:7",
            beforeExitKey: "secure.exit:return:1",
          },
        ],
        securityExits: [
          { exitKey: "secure.exit:return:1", exitKind: "return" },
          { exitKey: "secure.exit:trap:2", exitKind: "trap" },
        ],
        securityBranches: [],
        securityTableAccesses: [],
        securityHelperCalls: [],
        frameShape: "serializable-unwind",
        frameSizeBytes: 16,
        savedRegisters: [],
        wipeSlotKeys: ["spill-slot:vreg:7"],
      },
    ]);

    expect(securityInput.labels).toContainEqual({
      kind: "wipe-on-spill",
      subjectKey: "vreg:7",
      slotKey: "spill-slot:vreg:7",
    });
    const result = verifyAArch64SecurityLabelConservation(securityInput);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing trap wipe");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:wipe-on-spill-missing-before-exit:vreg:7:spill-slot:vreg:7:secure.exit:trap:2",
    ]);
  });
});
