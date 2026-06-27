import { describe, expect, test } from "bun:test";
import { hirLocalId } from "../../../src/hir/ids";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  draftFactKey,
  draftLocalKey,
  draftValueKey,
} from "../../../src/proof-mir/draft/draft-keys";
import {
  createProofMirGraphSsa,
  proofMirSsaFactKey,
  proofMirSsaKeyString,
  proofMirSsaLocalKey,
  type ProofMirGraphSsa,
  type ProofMirSsaKey,
} from "../../../src/proof-mir/domains/graph-ssa";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";

const FUNCTION_INSTANCE_ID = monoInstanceId("fn:main");
const OWNER_KEY = `function:${String(FUNCTION_INSTANCE_ID)}`;

function localKey(name: string) {
  const index = name === "x" ? 1 : name === "y" ? 2 : name === "i" ? 3 : 4;
  return draftLocalKey({
    functionInstanceId: FUNCTION_INSTANCE_ID,
    monoLocalId: instantiatedHirId(FUNCTION_INSTANCE_ID, hirLocalId(index)),
  });
}

function valueKey(role: string) {
  return draftValueKey({
    functionInstanceId: FUNCTION_INSTANCE_ID,
    role,
  });
}

function blockKey(role: string) {
  return proofMirCanonicalKey(`block|function:${String(FUNCTION_INSTANCE_ID)}|role:${role}`);
}

function edgeKey(role: string) {
  return proofMirCanonicalKey(`edge|function:${String(FUNCTION_INSTANCE_ID)}|role:${role}`);
}

function ssaLocal(name: string): ProofMirSsaKey {
  return proofMirSsaLocalKey(localKey(name));
}

function ssaFact(role: string): ProofMirSsaKey {
  return proofMirSsaFactKey(
    draftFactKey({
      role,
      kind: "comparison",
      authorityKey: "test",
    }),
  );
}

interface SsaGraphForTest {
  defineLocal(localName: string, blockRole: string): ReturnType<typeof valueKey>;
  createBlock(input: {
    readonly role?: string;
    readonly sealed?: boolean;
  }): ReturnType<typeof blockKey>;
  addPredecessor(
    block: ReturnType<typeof blockKey>,
    edgeRole: string,
    fromBlock: ReturnType<typeof blockKey>,
    argumentsByLocal: Readonly<Record<string, ReturnType<typeof valueKey>>>,
  ): void;
  seal(block: ReturnType<typeof blockKey>): void;
  readLocal(
    block: ReturnType<typeof blockKey>,
    localName: string,
  ): ReturnType<typeof valueKey> | undefined;
  blockParameters(
    block: ReturnType<typeof blockKey>,
  ): ReturnType<ProofMirGraphSsa["blockParameters"]>;
  edgeArguments(edgeRole: string): readonly ReturnType<typeof valueKey>[];
  declareLoopHeaderParameters(
    block: ReturnType<typeof blockKey>,
    localNames: readonly string[],
  ): void;
  createEntry(copyScalarLocalNames: readonly string[]): ReturnType<typeof blockKey>;
  diagnostics(): ReturnType<ProofMirGraphSsa["diagnostics"]>;
}

function createSsaGraphForTest(): SsaGraphForTest {
  const ssa = createProofMirGraphSsa({
    functionInstanceId: FUNCTION_INSTANCE_ID,
    ownerKey: OWNER_KEY,
  });
  let anonymousBlockCount = 0;

  function registerBlock(role: string, sealed: boolean) {
    const key = blockKey(role);
    ssa.registerBlock(key, { sealed });
    return key;
  }

  return {
    createEntry(copyScalarLocalNames) {
      const entry = registerBlock("entry", true);
      ssa.createEntryParameters({
        blockKey: entry,
        copyScalarParameters: copyScalarLocalNames.map((localName, index) => ({
          ssaKey: ssaLocal(localName),
          valueKey: valueKey(`entry-param:${localName}:${index}`),
        })),
      });
      return entry;
    },

    createBlock(input) {
      const role = input.role ?? `anonymous:${anonymousBlockCount++}`;
      return registerBlock(role, input.sealed ?? false);
    },

    defineLocal(localName, blockRole) {
      const key = valueKey(`${blockRole}:${localName}`);
      ssa.defineScalar({
        blockKey: blockKey(blockRole),
        ssaKey: ssaLocal(localName),
        valueKey: key,
      });
      return key;
    },

    addPredecessor(block, edgeRole, fromBlock, argumentsByLocal) {
      const edge = edgeKey(edgeRole);
      const orderedArgumentKeys = Object.keys(argumentsByLocal)
        .sort()
        .map((localName) => argumentsByLocal[localName]!);

      ssa.registerPredecessorEdge({
        blockKey: block,
        edgeKey: edge,
        fromBlockKey: fromBlock,
        argumentKeysBySsaKey: Object.fromEntries(
          Object.entries(argumentsByLocal).map(([localName, argumentValueKey]) => [
            proofMirSsaKeyString(ssaLocal(localName)),
            argumentValueKey,
          ]),
        ),
      });

      if (orderedArgumentKeys.length > 0) {
        ssa.setEdgeArguments({
          edgeKey: edge,
          argumentKeys: orderedArgumentKeys,
        });
      }
    },

    seal(block) {
      ssa.sealBlock(block);
    },

    readLocal(block, localName) {
      return ssa.readScalar({
        blockKey: block,
        ssaKey: ssaLocal(localName),
      });
    },

    blockParameters(block) {
      return ssa.blockParameters(block);
    },

    edgeArguments(edgeRole) {
      return ssa.edgeArgumentKeys(edgeKey(edgeRole));
    },

    declareLoopHeaderParameters(block, localNames) {
      ssa.declareLoopHeaderParameters({
        blockKey: block,
        parameters: localNames.map((localName, index) => ({
          ssaKey: ssaLocal(localName),
          valueKey: valueKey(`loop-header:${localName}:${index}`),
          parameterKind: "copyScalar" as const,
        })),
      });
    },

    diagnostics() {
      return ssa.diagnostics();
    },
  };
}

describe("ProofMirGraphSsa", () => {
  test("sealed block SSA writes join arguments on predecessor edges", () => {
    const graph = createSsaGraphForTest();
    graph.createBlock({ role: "then", sealed: true });
    graph.createBlock({ role: "else", sealed: true });
    const thenValue = graph.defineLocal("x", "then");
    const elseValue = graph.defineLocal("x", "else");
    const join = graph.createBlock({ role: "join", sealed: false });

    graph.addPredecessor(join, "edge:then", blockKey("then"), { x: thenValue });
    graph.addPredecessor(join, "edge:else", blockKey("else"), { x: elseValue });
    graph.seal(join);

    const joined = graph.readLocal(join, "x");
    expect(joined).toBeDefined();

    expect(graph.blockParameters(join).map((parameter) => parameter.valueKey)).toEqual([joined!]);
    expect(graph.edgeArguments("edge:then")).toEqual([thenValue]);
    expect(graph.edgeArguments("edge:else")).toEqual([elseValue]);
  });

  test("entry block parameters are created in signature order for copy scalar parameters", () => {
    const ssa = createProofMirGraphSsa({
      functionInstanceId: FUNCTION_INSTANCE_ID,
      ownerKey: OWNER_KEY,
    });
    const entry = blockKey("entry");
    ssa.registerBlock(entry, { sealed: true });
    ssa.createEntryParameters({
      blockKey: entry,
      copyScalarParameters: [
        { ssaKey: ssaLocal("y"), valueKey: valueKey("param:y") },
        { ssaKey: ssaLocal("x"), valueKey: valueKey("param:x") },
      ],
    });

    expect(
      ssa.blockParameters(entry).map((parameter) => proofMirSsaKeyString(parameter.ssaKey)),
    ).toEqual([proofMirSsaKeyString(ssaLocal("y")), proofMirSsaKeyString(ssaLocal("x"))]);
  });

  test("reads from sealed blocks with one predecessor reuse predecessor values", () => {
    const graph = createSsaGraphForTest();
    graph.createBlock({ role: "pred", sealed: true });
    const value = graph.defineLocal("x", "pred");
    const succ = graph.createBlock({ role: "succ", sealed: false });

    graph.addPredecessor(succ, "edge:pred", blockKey("pred"), { x: value });
    graph.seal(succ);

    expect(graph.readLocal(succ, "x")).toBe(value);
    expect(graph.blockParameters(succ)).toHaveLength(0);
  });

  test("reads from sealed blocks with multiple different predecessors create block parameters", () => {
    const graph = createSsaGraphForTest();
    graph.createBlock({ role: "then", sealed: true });
    graph.createBlock({ role: "else", sealed: true });
    const thenValue = graph.defineLocal("x", "then");
    const elseValue = graph.defineLocal("x", "else");
    const join = graph.createBlock({ role: "join", sealed: false });

    graph.addPredecessor(join, "edge:then", blockKey("then"), { x: thenValue });
    graph.addPredecessor(join, "edge:else", blockKey("else"), { x: elseValue });
    graph.seal(join);

    const joined = graph.readLocal(join, "x");
    expect(graph.blockParameters(join)).toHaveLength(1);
    expect(graph.blockParameters(join)[0]?.valueKey).toBe(joined);
  });

  test("reads from unsealed blocks create incomplete parameters that are completed on seal", () => {
    const graph = createSsaGraphForTest();
    graph.createBlock({ role: "then", sealed: true });
    graph.createBlock({ role: "else", sealed: true });
    const thenValue = graph.defineLocal("x", "then");
    const elseValue = graph.defineLocal("x", "else");
    const join = graph.createBlock({ role: "join", sealed: false });

    const incomplete = graph.readLocal(join, "x");
    expect(incomplete).toBeDefined();
    expect(graph.blockParameters(join)).toHaveLength(1);
    expect(graph.blockParameters(join)[0]?.valueKey).toBe(incomplete);
    expect(graph.blockParameters(join)[0]?.complete).toBe(false);

    graph.addPredecessor(join, "edge:then", blockKey("then"), { x: thenValue });
    graph.addPredecessor(join, "edge:else", blockKey("else"), { x: elseValue });
    graph.seal(join);

    expect(graph.readLocal(join, "x")).toBe(incomplete);
    expect(graph.blockParameters(join)[0]?.complete).toBe(true);
    expect(graph.edgeArguments("edge:then")).toEqual([thenValue]);
    expect(graph.edgeArguments("edge:else")).toEqual([elseValue]);
  });

  test("predeclared loop-header parameters win over on-demand incomplete parameters", () => {
    const graph = createSsaGraphForTest();
    const header = graph.createBlock({ role: "loop-header", sealed: false });
    graph.declareLoopHeaderParameters(header, ["i"]);
    const onDemand = graph.readLocal(header, "i");

    expect(graph.blockParameters(header)).toHaveLength(1);
    expect(graph.blockParameters(header)[0]?.valueKey).toBe(onDemand);
    expect(graph.blockParameters(header)[0]?.predeclared).toBe(true);
  });

  test("matching predecessor values reuse a single value without creating a block parameter", () => {
    const graph = createSsaGraphForTest();
    graph.createBlock({ role: "left", sealed: true });
    graph.createBlock({ role: "right", sealed: true });
    const sharedValue = graph.defineLocal("x", "left");
    graph.defineLocal("x", "right");
    const join = graph.createBlock({ role: "join", sealed: false });

    graph.addPredecessor(join, "edge:left", blockKey("left"), { x: sharedValue });
    graph.addPredecessor(join, "edge:right", blockKey("right"), { x: sharedValue });
    graph.seal(join);

    expect(graph.readLocal(join, "x")).toBe(sharedValue);
    expect(graph.blockParameters(join)).toHaveLength(0);
  });

  test("duplicate scalar definitions in the same block produce PROOF_MIR_INVALID_SSA", () => {
    const ssa = createProofMirGraphSsa({
      functionInstanceId: FUNCTION_INSTANCE_ID,
      ownerKey: OWNER_KEY,
    });
    const block = blockKey("body");
    ssa.registerBlock(block);
    ssa.defineScalar({ blockKey: block, ssaKey: ssaLocal("x"), valueKey: valueKey("v1") });
    ssa.defineScalar({ blockKey: block, ssaKey: ssaLocal("x"), valueKey: valueKey("v2") });

    expect(ssa.diagnostics().map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_SSA"),
    );
  });

  test("missing edge arguments on seal produce PROOF_MIR_INVALID_SSA", () => {
    const ssa = createProofMirGraphSsa({
      functionInstanceId: FUNCTION_INSTANCE_ID,
      ownerKey: OWNER_KEY,
    });
    const pred = blockKey("pred");
    const join = blockKey("join");
    ssa.registerBlock(pred, { sealed: true });
    ssa.defineScalar({
      blockKey: pred,
      ssaKey: ssaLocal("x"),
      valueKey: valueKey("pred:x"),
    });
    ssa.registerBlock(join, { sealed: false });
    ssa.readScalar({ blockKey: join, ssaKey: ssaLocal("x") });
    ssa.registerPredecessorEdge({
      blockKey: join,
      edgeKey: edgeKey("edge:missing-args"),
      fromBlockKey: pred,
    });
    ssa.sealBlock(join);

    expect(ssa.diagnostics().map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_SSA"),
    );
  });

  test("incomplete parameters after sealing produce PROOF_MIR_INVALID_SSA", () => {
    const ssa = createProofMirGraphSsa({
      functionInstanceId: FUNCTION_INSTANCE_ID,
      ownerKey: OWNER_KEY,
    });
    const join = blockKey("join");
    ssa.registerBlock(join, { sealed: false });
    ssa.readScalar({ blockKey: join, ssaKey: ssaLocal("x") });
    ssa.sealBlock(join);

    expect(ssa.diagnostics().map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_SSA"),
    );
  });

  test("proof fact tokens participate in SSA joins", () => {
    const ssa = createProofMirGraphSsa({
      functionInstanceId: FUNCTION_INSTANCE_ID,
      ownerKey: OWNER_KEY,
    });
    const thenBlock = blockKey("then");
    const elseBlock = blockKey("else");
    const join = blockKey("join");
    const fact = ssaFact("branch-fact");
    const thenValue = valueKey("fact:then");
    const elseValue = valueKey("fact:else");

    ssa.registerBlock(thenBlock, { sealed: true });
    ssa.registerBlock(elseBlock, { sealed: true });
    ssa.registerBlock(join, { sealed: false });
    ssa.defineScalar({ blockKey: thenBlock, ssaKey: fact, valueKey: thenValue });
    ssa.defineScalar({ blockKey: elseBlock, ssaKey: fact, valueKey: elseValue });
    ssa.registerPredecessorEdge({
      blockKey: join,
      edgeKey: edgeKey("edge:then"),
      fromBlockKey: thenBlock,
      argumentKeysBySsaKey: {
        [proofMirSsaKeyString(fact)]: thenValue,
      },
    });
    ssa.setEdgeArguments({ edgeKey: edgeKey("edge:then"), argumentKeys: [thenValue] });
    ssa.registerPredecessorEdge({
      blockKey: join,
      edgeKey: edgeKey("edge:else"),
      fromBlockKey: elseBlock,
      argumentKeysBySsaKey: {
        [proofMirSsaKeyString(fact)]: elseValue,
      },
    });
    ssa.setEdgeArguments({ edgeKey: edgeKey("edge:else"), argumentKeys: [elseValue] });
    ssa.sealBlock(join);

    const joined = ssa.readScalar({ blockKey: join, ssaKey: fact });
    expect(ssa.blockParameters(join)).toHaveLength(1);
    expect(ssa.blockParameters(join)[0]?.parameterKind).toBe("proofFact");
    expect(ssa.edgeArgumentKeys(edgeKey("edge:then"))).toEqual([thenValue]);
    expect(ssa.edgeArgumentKeys(edgeKey("edge:else"))).toEqual([elseValue]);
    expect(joined).toBe(ssa.blockParameters(join)[0]?.valueKey);
  });
});
