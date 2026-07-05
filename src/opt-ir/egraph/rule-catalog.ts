import { optIrRewriteRegionId, optimizationPassId } from "../ids";
import {
  passInvariantCheckerId,
  passInvariantSchemaId,
  type FactPreservationRule,
  type PassInvariantSchema,
  type RewriteInvariant,
} from "../passes/pass-contract";
import { factKindsForGate, optIrFactGate, type OptIrFactGate } from "./fact-gated-rule";
import {
  type OptIrRewriteRecordInput,
  optIrRewriteRule,
  type OptIrRewriteRule,
} from "./rewrite-rule";

export const OPT_IR_EGRAPH_RULE_IDS = [
  "opt-ir.egraph.endian-load-folding",
  "opt-ir.egraph.bounds-branch-deletion",
  "opt-ir.egraph.move-copy-erasure",
  "opt-ir.egraph.layout-arithmetic-folding",
  "opt-ir.egraph.parser-state-collapse",
  "opt-ir.egraph.field-disjoint-memory-cse",
  "opt-ir.egraph.platform-wrapper-collapse",
  "opt-ir.egraph.vector-idiom-preparation",
] as const;

export interface OptIrRuleCatalog {
  readonly passId: ReturnType<typeof optimizationPassId>;
  readonly rules: readonly OptIrRewriteRule[];
  readonly invariantSchemas: readonly PassInvariantSchema[];
}

const PASS_ID = optimizationPassId("opt-ir.fact-gated-egraph");

export function createDefaultOptIrRuleCatalog(): OptIrRuleCatalog {
  const ruleInputs = [
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[0],
      name: "Endian load folding",
      patternKinds: ["memoryLoad", "layoutEndianDecode"],
      replacementKinds: ["memoryLoad"],
      gate: optIrFactGate.conjunction([
        optIrFactGate.layout("access-layout"),
        optIrFactGate.bounds("access-bounds"),
      ]),
      decomposesTo: [{ kind: "layoutEndianEquivalence" }, { kind: "boundsDominanceElimination" }],
      preserveFactKind: "layoutAbi",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[1],
      name: "Bounds branch deletion",
      patternKinds: ["integerCompare"],
      replacementKinds: ["constant"],
      gate: optIrFactGate.bounds("dominating-validation"),
      decomposesTo: [{ kind: "boundsDominanceElimination" }],
      preserveFactKind: "validatedBuffer",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[2],
      name: "Move and copy erasure",
      patternKinds: ["sourceCall", "proofErasedMarker"],
      replacementKinds: ["proofErasedMarker"],
      gate: optIrFactGate.conjunction([
        optIrFactGate.alias("ownership-transfer"),
        optIrFactGate.privateState("erased-wrapper-state"),
      ]),
      decomposesTo: [{ kind: "ownershipRuntimeIdentity" }, { kind: "privateStateEquivalence" }],
      preserveFactKind: "ownership",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[3],
      name: "Layout arithmetic folding",
      patternKinds: ["layoutOffset", "integerBinary", "layoutByteRange"],
      replacementKinds: ["layoutByteRange"],
      gate: optIrFactGate.layout("layout-term"),
      decomposesTo: [{ kind: "layoutEndianEquivalence" }, { kind: "pureAlgebraicEquivalence" }],
      preserveFactKind: "layoutAbi",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[4],
      name: "Parser state collapse",
      patternKinds: ["aggregateConstruct", "aggregateExtract", "memoryLoad"],
      replacementKinds: ["memoryLoad"],
      gate: optIrFactGate.conjunction([
        optIrFactGate.privateState("parser-state"),
        optIrFactGate.bounds("validated-field"),
        optIrFactGate.terminal("rejected-paths"),
      ]),
      decomposesTo: [
        { kind: "privateStateEquivalence" },
        { kind: "boundsDominanceElimination" },
        { kind: "terminalReachabilityEquivalence" },
      ],
      preserveFactKind: "privateState",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[5],
      name: "Field-disjoint memory CSE",
      patternKinds: ["memoryLoad", "memoryLoad"],
      replacementKinds: ["memoryLoad"],
      gate: optIrFactGate.conjunction([
        optIrFactGate.alias("field-regions"),
        optIrFactGate.effect("memory-window"),
      ]),
      decomposesTo: [{ kind: "noaliasMemoryEquivalence" }, { kind: "effectBoundaryEquivalence" }],
      preserveFactKind: "fieldDisjointness",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[6],
      name: "Platform wrapper collapse",
      patternKinds: ["sourceCall", "platformCall"],
      replacementKinds: ["platformCall"],
      gate: optIrFactGate.conjunction([
        optIrFactGate.effect("wrapper-effects"),
        optIrFactGate.abi("wrapper-abi"),
        optIrFactGate.terminal("wrapper-terminal"),
        optIrFactGate.capabilityFlow("wrapper-capability-flow"),
      ]),
      decomposesTo: [
        { kind: "effectBoundaryEquivalence" },
        { kind: "abiWrapperEquivalence" },
        { kind: "terminalReachabilityEquivalence" },
        { kind: "capabilityFlowEquivalence" },
      ],
      preserveFactKind: "platformEffect",
    }),
    ruleInput({
      ruleId: OPT_IR_EGRAPH_RULE_IDS[7],
      name: "Vector idiom preparation",
      patternKinds: ["memoryLoad", "integerCompare"],
      replacementKinds: ["vectorLoad", "vectorCompare"],
      gate: optIrFactGate.none(),
      decomposesTo: [{ kind: "vectorLaneEquivalence" }, { kind: "pureAlgebraicEquivalence" }],
      preserveFactKind: "passDerived",
    }),
  ] as const;
  const rules = ruleInputs.map((input) => {
    const rule = optIrRewriteRule({
      ruleId: input.ruleId,
      name: input.name,
      passId: PASS_ID,
      pattern: {
        operationKinds: input.patternKinds,
        subjectRoles: ["operation", "region"],
      },
      replacement: {
        operationKinds: input.replacementKinds,
        subjectRoles: ["operation", "region"],
      },
      factGate: input.gate,
      invariant: input.invariant,
      invariantSchema: input.schema,
      preservationRules: [preservationRule(input.ruleId, input.preserveFactKind)],
      primaryPreservationRuleId: `${input.ruleId}:preserve:${input.preserveFactKind}`,
    });
    const consumedFactFamilies = factKindsForGate(input.gate);
    return Object.freeze({
      ...rule,
      createRewriteRecord(recordInput: OptIrRewriteRecordInput) {
        const record = rule.createRewriteRecord(recordInput);
        return Object.freeze({
          ...record,
          consumedFactFamilies: Object.freeze(consumedFactFamilies.slice()),
        });
      },
    });
  });

  return Object.freeze({
    passId: PASS_ID,
    rules: Object.freeze(rules),
    invariantSchemas: Object.freeze(rules.map((rule) => rule.invariantSchema)),
  });
}

function ruleInput(input: {
  readonly ruleId: (typeof OPT_IR_EGRAPH_RULE_IDS)[number];
  readonly name: string;
  readonly patternKinds: readonly OptIrRewriteRule["pattern"]["operationKinds"][number][];
  readonly replacementKinds: readonly OptIrRewriteRule["replacement"]["operationKinds"][number][];
  readonly gate: OptIrFactGate;
  readonly decomposesTo: readonly RewriteInvariant[];
  readonly preserveFactKind: FactPreservationRule["factKind"];
}) {
  const schemaId = passInvariantSchemaId(`${input.ruleId}:invariant`);
  const checker = passInvariantCheckerId(`${input.ruleId}:checker`);
  const invariant: RewriteInvariant = {
    kind: "passSpecificInvariant",
    schema: schemaId,
    checker,
    decomposesTo: input.decomposesTo,
  };
  const schema: PassInvariantSchema = {
    schemaId,
    passId: PASS_ID,
    operands: [
      { name: "operation", kind: "operation" },
      { name: "region", kind: "region" },
    ],
    requiredFacts: [],
    checker,
    decomposesTo: input.decomposesTo,
  };
  return Object.freeze({ ...input, invariant, schema });
}

function preservationRule(
  ruleId: (typeof OPT_IR_EGRAPH_RULE_IDS)[number],
  factKind: FactPreservationRule["factKind"],
): FactPreservationRule {
  const rule: FactPreservationRule = {
    ruleId: `${ruleId}:preserve:${factKind}`,
    factKind,
    subject: { kind: "substitution", table: "egraph-extraction-subject-remap" },
    scope: { kind: "rewrittenRegion", region: optIrRewriteRegionId(0) },
    dependencies: { kind: "remapped" },
    cfg: { kind: "unchanged" },
    memory: { kind: "equivalent", rule: ruleId },
    invalidations: { kind: "rejectTriggered" },
    result: factKind === "passDerived" ? "derived" : "preserved",
  };
  return Object.freeze(rule);
}
