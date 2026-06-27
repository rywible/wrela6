# Optimization Scorecard Design

## Purpose

Optimization scoring is a compiler-development scorecard, not a global
compile-time optimization judge.

The scorecard lives in the test and development suite. It compares
representative programs before and after optimization, explains which cost
features moved, and helps compiler developers decide whether OptIR
optimizations and register-selection optimizations are broadly doing useful
work.

The production compiler does not use these offline scores to accept or reject
ordinary optimization candidates. The production compiler runs approved
optimization policies directly:

```text
source
  -> checked MIR / proof facts
  -> pre-optimization OptIR
  -> approved OptIR optimization pipeline
  -> lowering
  -> approved register-selection pipeline
  -> emitted image
```

The optimization scorecard observes that pipeline from the side:

```text
representative fixture
  -> capture pre artifact
  -> run selected optimization stage
  -> capture post artifact
  -> score before and after
  -> report directional quality
```

The old working name was "gas". This design keeps the useful part of that
idea, a deterministic weighted cost model, but changes its authority. Scores
are not public runtime gas, not exact cycle predictions, and not compiler
correctness rules. They are diagnostic measurements for optimization work.

This does not mean the compiler has no compile-time cost logic. Approved
optimization policies still contain cheap, bounded, fact-aware heuristics for
local choices such as inlining, unrolling, branch lowering, instruction
selection, coalescing, splitting, spilling, and rematerialization. The
scorecard audits those policies offline; it does not replace them with a
whole-program transactional oracle.

The preferred names are:

```text
OptimizationScorecard:
  the offline suite and reporting system

OptIrScore:
  heuristic score for unallocated OptIR shape

RegisterScore:
  heuristic score for register-selected / allocated machine shape

OptimizationScoreReport:
  human and JSON report emitted by the scorecard runner
```

## Design Principle

The scorecard exists to answer development questions:

```text
Did this OptIR optimization improve the programs it claims to improve?
Did it merely move cost from checks into register pressure?
Did register selection reduce spills and moves on representative functions?
Did a coalescing heuristic help hot paths but hurt call-heavy code?
Which bucket explains this regression?
Which pass order or heuristic threshold looks best across the corpus?
```

It does not answer:

```text
Should the compiler accept this one candidate during normal compilation?
How many real cycles will this program take on a named CPU?
Should a user-visible gas meter charge this program differently?
```

The central rule is:

```text
Optimization scores are offline evidence.
Real benchmarks and emitted-code inspection remain the judge.
Local compile-time policies remain the decision-makers.
```

## Authority Boundary

This design gives up one ambition and preserves another.

Given up:

```text
global compile-time score authority
```

The compiler does not lower the whole image for every OptIR candidate, run all
register optimizations, compute a global score, and use that number as the
ordinary accept/reject rule. That design is clean in theory but creates a
combinatorial search over OptIR paths, lowering choices, register-selection
choices, and cleanup choices.

Preserved:

```text
proof-guided local optimization policy
```

Passes may still use certified bounds, noalias, layout, branch, effect, and
hotness facts to make bounded local decisions. For example, a pass can choose a
conditional select when a branch is locally cheap and predictable enough, avoid
an unroll when proof facts show register pressure would grow across a call, or
remove a bounds check because certified layout facts prove it redundant.

The scorecard's job is to keep those local policies honest across a curated
corpus. It is a microscope and trend line, not the hand on the compiler's
steering wheel.

## Goals

- Provide deterministic offline scores for OptIR optimization quality.
- Provide deterministic offline scores for register-selection quality.
- Keep scorecard scoring out of normal compile-time optimization decisions.
- Define the relationship between local compile-time heuristics and the
  offline scorecard that audits them.
- Keep the scorecard out of the default `agent:check` path, except for small
  unit tests of the scoring infrastructure itself.
- Use representative compiler fixtures instead of attempting exhaustive
  compile-time candidate search.
- Preserve multidimensional vectors so every scalar score has an explanation.
- Keep AArch64 in mind for register scoring while keeping the model abstract
  enough to retarget later.
- Make all weights explicit, checked in, reviewable, and deterministic.
- Support before/after reports, baseline files, trend tracking, and
  threshold-based sanity checks.
- Leave room for future offline brute search over pass ordering, pass
  combinations, and heuristic thresholds.

## Non-Goals

- The scorecard does not participate in production compile-time accept/reject
  decisions.
- The scorecard does not ban local compile-time cost heuristics inside
  approved optimization policies.
- The scorecard does not replace correctness tests for optimization passes.
- The scorecard does not predict exact cycle counts on a named CPU.
- The scorecard does not replace hardware benchmarking, emulator runs, or
  emitted assembly review.
- The scorecard does not define public runtime gas semantics.
- The scorecard does not automatically enable or disable production
  optimizations.
- The scorecard does not require brute-force search during ordinary
  compilation.
- The scorecard does not need source-level provenance unless a report needs it
  for debugging.

## Operating Modes

There are three distinct modes:

```text
production compile:
  run approved optimization policies
  use cheap local heuristics for bounded decisions
  do not score every candidate with the offline scorecard
  do not consult OptimizationScorecard

scorecard run:
  opt-in developer command
  run representative fixtures
  capture pre/post artifacts
  score and report deltas
  optionally compare against checked-in baselines

offline search lab:
  opt-in developer command
  enumerate or sample pass orders, pass combinations, register heuristics,
    and thresholds
  compile representative fixtures for each configuration
  score outcomes
  produce policy recommendations for human review
```

The scorecard command is intentionally outside the default handoff path:

```text
bun run optimization:score
bun run optimization:score -- --case packet-parser
bun run optimization:score -- --group opt-ir
bun run optimization:score -- --group register
bun run optimization:score -- --json reports/optimization-score.json
bun run optimization:score -- --update-baselines
```

`agent:check` should not run the full representative score corpus. Cheap unit
tests for score arithmetic, vector extraction, and report formatting may be in
the ordinary test suite. The expensive corpus run remains opt-in.

## Why This Is Offline

If the compiler uses the score as compile-time authority, every optimization
choice starts to interact with every later optimization choice:

```text
possible outcomes =
  OptIR optimization paths
  * lowering choices
  * register-selection choices
  * cleanup choices
```

That search space grows too quickly. It also makes individual pass decisions
misleading: an OptIR rewrite scored with all register optimizations enabled
does not tell us whether one register optimization was good, and a register
optimization scored after one fixed OptIR path does not tell us whether a
different OptIR path would have made it better.

The scorecard avoids that knot by changing the question:

```text
compile time:
  What does the approved compiler policy do?
  Which local alternative should this pass choose?

scorecard time:
  Did that policy improve representative programs?
  Which pass, threshold, or register heuristic explains the movement?
```

Production compilation remains simple and deterministic. Development scoring
can afford slower comparisons, ablations, and searches because it is opt-in.

## Local Compile-Time Policies

Production optimization policy is not context-free. It contains local
heuristics for bounded decisions where the pass already has a small set of
legal alternatives.

Examples:

```text
OptIR:
  inline or do not inline a known call
  choose an unroll factor from a small finite set
  keep branch form or lower to conditional select
  remove, hoist, or retain a runtime check
  materialize a derived value or recompute it later

Lowering and instruction selection:
  choose one legal instruction form among a few encodings
  fold an address calculation into a load/store
  choose scalar lowering or vector idiom lowering
  select compare-and-branch or compare plus conditional dataflow

Register selection:
  coalesce or keep a copy boundary
  split a live range at a local boundary
  spill, rematerialize, or keep a value live
  prefer caller-save or callee-save pressure for a call-heavy region
```

A local policy decision must be bounded:

```text
local_policy_decision =
  choose one alternative from a finite set already produced by the pass
```

It must not silently become a whole-program search:

```text
not allowed:
  recursively run the whole optimizer for every alternative
  brute-force pass combinations during production compilation
  consult scorecard baselines or benchmark data during production compilation
```

Local policies may use certified per-program facts:

```text
allowed facts:
  bounds and layout facts
  noalias and disjointness facts
  branch probability or hotness facts
  call effect facts
  volatility, MMIO, and platform effect facts
  local liveness and register-class pressure
```

The policy should emit a lightweight decision log in debug or scorecard runs:

```ts
export interface LocalPolicyDecisionLog {
  readonly decisionId: string;
  readonly policyId: string;
  readonly decisionKind:
    | "inline"
    | "unroll"
    | "branchLowering"
    | "checkElimination"
    | "instructionSelection"
    | "coalescing"
    | "liveRangeSplit"
    | "spill"
    | "rematerialization";
  readonly chosenAlternative: string;
  readonly rejectedAlternatives: readonly string[];
  readonly factsUsed: readonly string[];
  readonly featureVector: LocalPolicyFeatureVector;
  readonly explanation: readonly string[];
}
```

The scorecard and local policies should share feature vocabulary where possible
without sharing authority:

```text
shared vocabulary:
  runtime checks
  memory ordering
  branch shape
  register pressure
  spills and reloads
  copies and coalescing
  call-boundary pressure
  dependency depth
  code size
```

The relationship is:

```text
local policy:
  makes bounded compile-time decisions

decision log:
  records why those decisions were made

scorecard:
  measures whether the resulting artifacts improved representative cases

ablation/search:
  evaluates alternative policy configurations offline
```

This is the missing middle between "global compile-time score oracle" and
"no compile-time cost model". The compiler keeps cheap local judgment. The
scorecard keeps that judgment accountable.

## Scorecard Cases

A scorecard case is a representative program plus a measurement boundary.

```ts
export interface OptimizationScoreCase {
  readonly caseId: string;
  readonly description: string;
  readonly group: "optIr" | "register" | "pipeline";
  readonly fixture: OptimizationFixture;
  readonly inputShapes: readonly OptimizationInputShape[];
  readonly capture: ScoreCapturePoint;
  readonly profile: OptimizationScoreProfile;
  readonly expectations: readonly ScoreExpectation[];
}
```

Examples:

```text
packet-parser-bounds-check-elim:
  group: optIr
  input_shapes: packet_len_64, packet_len_512, packet_len_1500
  boundary: pre_opt_ir -> post_bounds_check_elim_opt_ir
  expects:
    runtime_check_score decreases
    memory_shape_score does not regress materially
    registerability_score does not regress materially

copy-heavy-coalescing:
  group: register
  boundary: pre_register_selection -> post_register_selection
  expects:
    copy_score decreases
    spill_score does not increase

call-heavy-spill-policy:
  group: register
  boundary: pre_register_selection -> post_register_selection
  expects:
    call_live_score decreases
    callee_save_score does not dominate
```

Cases should be small enough to understand and stable enough to make reports
useful. The scorecard is not a fuzzing system. It is a curated measurement
suite for optimization intent.

## Input Shape Coverage

The scorecard does not need a full probabilistic workload model, but it must
not pretend that one static artifact represents every important input. If an
optimization can behave differently across input shapes, the case should
encode those shapes explicitly.

```ts
export interface OptimizationInputShape {
  readonly shapeId: string;
  readonly description: string;
  readonly weight: ScoreNumber;
  readonly facts: readonly OptimizationShapeFact[];
}
```

Examples:

```text
packet parser:
  packet_len_64:
    weight: 0.30
    facts: packet length is 64

  packet_len_512:
    weight: 0.35
    facts: packet length is 512

  packet_len_1500:
    weight: 0.35
    facts: packet length is 1500

call-heavy path:
  no_error:
    weight: 0.98
    facts: validation succeeds

  validation_error:
    weight: 0.02
    facts: validation fails and cold error path runs
```

Shape ids are reported independently before they are aggregated:

```text
packet-parser-bounds-check-elim
  packet_len_64:   -18.0%
  packet_len_512:  -34.2%
  packet_len_1500: -41.7%
```

This keeps input-sensitive behavior visible without rebuilding the full
compile-time scenario machinery. Important adversarial, boundary, cold-error,
and small-input shapes should be separate scorecard shapes, not hidden inside
one averaged fixture.

## Artifact Boundaries

The scorecard measures explicit before/after artifacts.

For OptIR:

```text
pre_opt_ir:
  OptIR after lowering from checked MIR and proof facts, before the target
  optimization or optimization group.

post_opt_ir:
  OptIR after the target optimization or optimization group and its required
  cleanup canonicalization.
```

For register selection:

```text
pre_register_selection:
  lowered machine-like program before physical register selection. It has
  register classes, constraints, call boundaries, blocks, and instruction
  forms, but not final physical registers or spill code.

post_register_selection:
  allocated machine-like program after physical register assignment,
  coalescing, spill/reload insertion, callee-save decisions, stack slot
  assignment, and required cleanup.
```

The register scorer may start with an abstract allocated machine form before a
full backend exists. The design requirement is stable semantics, not final
emission.

## Score Semantics

Scores are deterministic weighted sums over feature vectors.

Lower is better:

```text
delta = score_after - score_before

delta < 0:
  improvement

delta = 0:
  neutral

delta > 0:
  regression
```

A scalar score is only a summary. The vector is the truth:

```text
score(artifact, profile) =
  sum_bucket profile.weight(bucket) * measure(artifact, bucket)
```

For a case:

```text
before_score = score(before_artifact, profile)
after_score = score(after_artifact, profile)
absolute_delta = after_score - before_score
relative_delta =
  absolute_delta / max(before_score, profile.relativeScoreFloor)
```

For a suite:

```text
case_improvement(case) =
  max(-relative_delta(case), 0)

case_regression(case) =
  max(relative_delta(case), 0)

capped_case_credit(case) =
  min(case_improvement(case), profile.maxRelativeCredit)

weighted_mean_delta =
  sum_case case_weight(case)
    * (case_regression(case) - capped_case_credit(case))

worst_regression =
  max_case case_regression(case)

expectation_failure_penalty =
  sum_failed_expectation penalty(expectation.severity)

suite_score =
  weighted_mean_delta
  + profile.worstRegressionWeight * worst_regression
  + expectation_failure_penalty
```

Positive wins are capped because a giant synthetic improvement should not hide
the rest of the corpus. Regressions are not capped in the same way. A
catastrophic fixture should remain loud in both `worst_regression` and the
expectation failure list.

Score numbers are abstract points. They are not cycles. They are only
comparable inside one score profile.

## Numeric Determinism

The scorecard must be deterministic across hosts.

Use fixed-point integer arithmetic for score values:

```text
ScoreNumber =
  raw: signed bigint
  scale_bits: profile-declared fixed-point scale
```

Default:

```text
score_scale_bits: 24
rounding_mode: halfEven
comparison_epsilon_points: 0
```

All aggregation happens in canonical order:

```text
case id
artifact id
function id
block id
instruction or node id
bucket id
```

The scorecard may print decimal values for humans, but JSON reports store
canonical fixed-point values.

## OptIR Score

`OptIrScore` measures whether an OptIR optimization produced a better
optimization substrate.

It intentionally scores unallocated IR. It does not pretend to know final
register allocation. It asks whether the post-optimization IR is structurally
better according to local, explainable heuristics.

```ts
export interface OptIrScoreVector {
  readonly work: OptIrWorkScore;
  readonly control: OptIrControlScore;
  readonly memory: OptIrMemoryScore;
  readonly runtimeChecks: OptIrRuntimeCheckScore;
  readonly factUse: OptIrFactUseScore;
  readonly registerability: OptIrRegisterabilityScore;
  readonly selectability: OptIrSelectabilityScore;
  readonly codeShape: OptIrCodeShapeScore;
  readonly uncertainty: OptIrUncertaintyScore;
}
```

Default reduction:

```text
OptIrScore =
  work_score
  + control_score
  + memory_score
  + runtime_check_score
  + fact_use_score
  + registerability_score
  + selectability_score
  + code_shape_score
  + uncertainty_score
```

### OptIR Work

Work score approximates remaining dynamic work:

```text
work_score =
  w.scalar_op * scalar_ops
  + w.integer_mul * integer_mul_ops
  + w.divide * divide_or_mod_ops
  + w.compare * compare_ops
  + w.address_calc * address_calculation_ops
  + w.load * load_ops
  + w.store * store_ops
  + w.call * call_ops
  + w.effect_barrier * effect_barrier_ops
```

Use representative block hotness when available:

```text
weighted_ops =
  sum_block hotness(block) * op_count(block)
```

When hotness is unknown, use deterministic synthetic hotness:

```text
entry block: 1.0
loop body block: loop_weight
cold validation/error block: cold_weight if marked cold, else 1.0
```

### OptIR Control Shape

Control score captures branch and CFG complexity:

```text
control_score =
  w.block * block_count
  + w.edge * edge_count
  + w.branch * branch_count
  + w.unpredictable_branch * unknown_probability_branch_count
  + w.loop * loop_count
  + w.loop_depth * sum_block loop_depth(block)
  + w.irreducible * irreducible_region_count
```

Cold-path isolation is good. A bounds-check elimination pass can improve the
score even if it leaves a cold error path behind:

```text
cold_path_credit =
  w.cold_path_isolation
  * isolated_cold_block_count
```

The credit must be capped:

```text
effective_cold_path_credit =
  min(cold_path_credit, profile.maxColdPathCredit)
```

### OptIR Memory Shape

Memory score captures aliasing, locality, and ordering pressure:

```text
memory_score =
  w.memory_op * memory_ops
  + w.unknown_alias * unknown_alias_pairs
  + w.effect_order * ordered_memory_edges
  + w.volatile * volatile_accesses
  + w.mmio * mmio_accesses
  + w.random_access * random_access_groups
  + w.strided_access * strided_access_groups
  - w.sequential_group_credit * sequential_access_groups
```

Certified facts can reduce memory-shape cost:

```text
if noalias(place_a, place_b):
  unknown_alias_pair no longer counts

if layout proves contiguous field group:
  sequential_access_groups increases

if platform call does not write region:
  ordered_memory_edges may decrease
```

### Runtime Checks And Fact Use

Runtime checks are first-class because Wrela has proof-derived facts:

```text
runtime_check_score =
  w.bounds_check * remaining_bounds_checks
  + w.validation_check * remaining_validation_checks
  + w.null_or_presence_check * remaining_presence_checks
  + w.trap_edge * remaining_trap_edges
```

Fact-use score rewards optimization that consumes certified facts without
inventing unsafe assumptions:

```text
fact_use_score =
  - w.certified_bounds_fact * consumed_bounds_facts
  - w.certified_layout_fact * consumed_layout_facts
  - w.certified_noalias_fact * consumed_noalias_facts
  + w.uncertified_assumption * uncertified_assumption_count
```

The scorecard never treats fact use as proof of correctness. Correctness still
comes from compiler validation and pass invariants. The score only measures
whether optimization is exploiting facts that already exist.

### Registerability

Registerability predicts pressure without choosing physical registers:

```text
registerability_score =
  w.gpr_live_overlap * estimated_gpr_live_overlap
  + w.vector_live_overlap * estimated_vector_live_overlap
  + w.call_live * values_live_across_calls
  + w.long_range * long_live_ranges
  + w.wide_value * wide_or_aggregate_values
  + w.phi_pressure * phi_or_block_parameter_pressure
  + w.rematerialization_difficulty * hard_to_rematerialize_values
  + w.coalescing_difficulty * hard_to_coalesce_edges
  - w.clean_split_credit * clean_split_points
  - w.rematerializable_credit * cheap_rematerializable_values
```

This is explicitly heuristic. It is useful because many OptIR optimizations can
make register selection easier or harder long before physical registers exist.

### Selectability

Selectability measures how naturally OptIR can lower to target instruction
forms:

```text
selectability_score =
  w.generic_op * generic_ops
  + w.unsupported_idiom * unsupported_idioms
  + w.large_immediate * non_encodable_immediates
  + w.addressing_miss * missed_addressing_mode_opportunities
  + w.vector_tail * vector_tail_work
  - w.fused_compare_branch * fused_compare_branch_opportunities
  - w.conditional_select * conditional_select_opportunities
  - w.folded_address * folded_addressing_opportunities
  - w.vector_idiom * recognized_vector_idioms
```

For AArch64-shaped profiles, examples include:

- immediate encoding friendliness
- add/sub with shifted or extended operands
- load/store addressing modes
- compare-and-branch patterns
- conditional select opportunities
- NEON vector idioms when enabled by profile

## Register Score

`RegisterScore` measures the quality of register selection and allocation
after the register pipeline runs.

It scores realized choices:

```ts
export interface RegisterScoreVector {
  readonly allocation: RegisterAllocationScore;
  readonly spills: SpillScore;
  readonly copies: CopyScore;
  readonly calls: RegisterCallBoundaryScore;
  readonly frame: StackFrameScore;
  readonly dependency: RegisterDependencyScore;
  readonly instructionShape: RegisterInstructionShapeScore;
  readonly codeSize: RegisterCodeSizeScore;
  readonly uncertainty: RegisterUncertaintyScore;
}
```

Default reduction:

```text
RegisterScore =
  allocation_score
  + spill_score
  + copy_score
  + call_boundary_score
  + frame_score
  + dependency_score
  + instruction_shape_score
  + code_size_score
  + uncertainty_score
```

### Allocation Quality

Allocation score captures final physical-register quality:

```text
allocation_score =
  w.gpr_pressure_excess * excess_gpr_pressure
  + w.vector_pressure_excess * excess_vector_pressure
  + w.fixed_register_conflict * fixed_register_conflicts
  + w.register_class_mismatch * register_class_repairs
  + w.live_range_split * live_range_splits
  + w.unstable_assignment * avoidable_assignment_churn
```

For AArch64-shaped profiles, the scorer distinguishes:

- general-purpose registers
- condition flags
- SIMD/floating-point registers
- fixed ABI registers for calls and returns
- stack pointer and frame pointer constraints

The model remains abstract. It does not need proprietary core details.

### Spills And Reloads

Spill score is usually the most important register-selection metric:

```text
spill_score =
  w.spill_store * weighted_spill_stores
  + w.spill_reload * weighted_spill_reloads
  + w.spill_slot * spill_slot_count
  + w.hot_spill * hot_spill_ops
  + w.call_crossing_spill * spills_crossing_calls
  + w.vector_spill * vector_spill_ops
  + w.unaligned_spill * unaligned_spill_ops
```

Weighted counts use block hotness:

```text
weighted_spill_reloads =
  sum_reload hotness(block(reload)) * reload_weight(reload)
```

### Copies And Coalescing

Copy score measures whether the register pipeline removed unnecessary moves:

```text
copy_score =
  w.move * weighted_moves
  + w.parallel_copy * weighted_parallel_copies
  + w.phi_copy * phi_resolution_copies
  + w.call_arg_shuffle * call_argument_shuffles
  + w.return_shuffle * return_value_shuffles
  - w.coalesced_edge_credit * coalesced_edges
```

Credits are capped so a single coalescing-heavy case cannot hide spills:

```text
effective_coalescing_credit =
  min(raw_coalescing_credit, profile.maxCoalescingCredit)
```

### Calls, ABI, And Frame

Call-boundary score captures register pressure around calls:

```text
call_boundary_score =
  w.live_across_call * values_live_across_calls
  + w.caller_save_save_restore * caller_save_save_restore_ops
  + w.callee_save_register * callee_save_registers_used
  + w.indirect_call_pressure * indirect_call_live_pressure
```

Frame score captures stack impact:

```text
frame_score =
  w.stack_bytes * stack_frame_bytes
  + w.stack_slot * stack_slot_count
  + w.prologue_op * prologue_ops
  + w.epilogue_op * epilogue_ops
  - w.pair_save_restore_credit * pair_save_restore_ops
```

For AArch64, pair load/store opportunities are useful but profile-gated. The
scorecard can reward them without committing to an exact microarchitecture.

### Dependency And Instruction Shape

Dependency score approximates whether register selection made hot paths more
serial:

```text
dependency_score =
  w.hot_dependency_depth * hot_dependency_depth
  + w.reload_on_chain * reloads_on_dependency_chains
  + w.address_dependency * address_generation_chains
  + w.flag_dependency * condition_flag_dependency_chains
```

Instruction-shape score captures repair operations and missed forms:

```text
instruction_shape_score =
  w.repair_op * register_repair_ops
  + w.materialization_op * constant_materialization_ops
  + w.address_materialization * address_materialization_ops
  - w.folded_reload_credit * folded_reload_ops
  - w.rematerialized_credit * rematerialized_values
```

### Register Score Stability

Register allocation is discontinuous. A small policy change can recolor many
values, move spill slots, or change callee-save choices even when the semantic
program barely changed. Register score reports must therefore include stability
metrics, especially for ablations and threshold sweeps.

```text
allocation_churn =
  changed_physical_register_assignments
  + changed_spill_slots
  + changed_live_range_split_points
  + changed_callee_save_choices

normalized_allocation_churn =
  allocation_churn / max(total_allocated_values, 1)
```

The report should separate direct quality movement from churn:

```text
register score delta:
  spills:          -120.00
  copies:          -300.00
  frame:            +30.00
  dependency:       +20.00
  allocation churn:  0.42
```

High churn does not automatically mean the policy is bad, but it reduces
confidence in a narrow conclusion like "this one coalescing threshold helped."
For scorecard runs that compare register policies, the runner should support
stability probes:

```text
nop perturbation:
  add a neutral instruction or value and rerun the register policy

block order perturbation:
  reorder equally valid cold blocks and rerun

tie-break perturbation:
  change deterministic candidate ordering within an allowed equivalence class
```

Stability probe output:

```text
stability_score =
  mean_absolute_score_delta_across_perturbations
  + profile.churnWeight * mean_normalized_allocation_churn
```

Search and ablation reports should include `stability_score`. A policy that
wins only by exploiting fragile allocation artifacts should be treated as a
risky recommendation even when its suite score improves.

## Score Profiles

Profiles keep weights out of code:

```ts
export interface OptimizationScoreProfile {
  readonly profileId: string;
  readonly targetFamily: "generic" | "aarch64";
  readonly scoreScaleBits: number;
  readonly relativeScoreFloor: ScoreNumber;
  readonly maxRelativeCredit: ScoreNumber;
  readonly worstRegressionWeight: ScoreNumber;
  readonly churnWeight: ScoreNumber;
  readonly optIr: OptIrScoreWeights;
  readonly register: RegisterScoreWeights;
  readonly expectations: ScoreExpectationDefaults;
}
```

Example profile:

```text
generic-aarch64-scorecard:
  target_family: aarch64
  score_scale_bits: 24
  relative_score_floor: 100
  max_relative_credit: 0.50
  worst_regression_weight: 2.00
  churn_weight: 0.25

  opt_ir:
    scalar_op: 1
    integer_mul: 3
    divide: 20
    load: 4
    store: 4
    call: 12
    effect_barrier: 20
    bounds_check: 10
    unknown_alias: 3
    call_live_value: 4
    hard_to_coalesce_edge: 2
    folded_address_credit: 2
    vector_idiom_credit: 8

  register:
    spill_store: 10
    spill_reload: 12
    hot_spill: 20
    move: 2
    call_argument_shuffle: 4
    callee_save_register: 8
    stack_byte: 0.02
    hot_dependency_depth: 3
    folded_reload_credit: 4
```

The numbers are intentionally heuristic. Their job is to rank compiler changes
against the curated suite, not to model hardware exactly.

## Expectations

Each case can declare directional expectations:

```ts
export interface ScoreExpectation {
  readonly bucket: ScoreBucketPath;
  readonly direction: "decrease" | "increase" | "unchanged" | "any";
  readonly minRelativeImprovement?: ScoreNumber;
  readonly maxRelativeRegression?: ScoreNumber;
  readonly severity: "info" | "warning" | "failure";
}
```

Examples:

```text
bounds-check-elim:
  runtimeChecks.total:
    direction: decrease
    minRelativeImprovement: 0.25
    severity: warning

  registerability.total:
    direction: unchanged
    maxRelativeRegression: 0.05
    severity: warning

coalescing:
  copies.total:
    direction: decrease
    minRelativeImprovement: 0.15
    severity: warning

  spills.total:
    direction: unchanged
    maxRelativeRegression: 0.00
    severity: failure
```

An expectation failure means "this optimization should be inspected." It does
not mean the compiler is semantically wrong.

## Reports

The human report should be delta-first:

```text
packet-parser-bounds-check-elim

OptIR score:
  before: 1820.00
  after:  1130.00
  delta:  -690.00 (-37.91%)
  verdict: improvement

Changed buckets:
  runtime checks:    -480.00
  memory shape:       -60.00
  control shape:      -90.00
  registerability:    +15.00
  selectability:      -75.00

Expectation notes:
  ok: runtimeChecks.total decreased by 52.1%
  warn: registerability regressed by 1.8%, below 5.0% limit

Top explanations:
  removed 48 hot bounds checks using certified layout facts
  folded 12 address calculations into load/store addressing forms
  added 3 values live across parser helper call
```

The JSON report should be stable enough for trend tooling:

```ts
export interface OptimizationScoreReport {
  readonly profileId: string;
  readonly generatedAtCompilerRevision?: string;
  readonly cases: readonly OptimizationScoreCaseReport[];
  readonly suite: OptimizationScoreSuiteSummary;
}

export interface OptimizationScoreCaseReport {
  readonly caseId: string;
  readonly group: "optIr" | "register" | "pipeline";
  readonly before: ScoreArtifactReport;
  readonly after: ScoreArtifactReport;
  readonly delta: ScoreDeltaReport;
  readonly expectations: readonly ScoreExpectationResult[];
  readonly explanations: readonly ScoreExplanation[];
}
```

## Baselines

Baselines are checked-in score snapshots for representative cases:

```text
tests/optimization/baselines/
  generic-aarch64-scorecard.json
```

A baseline records:

```text
case id
profile id
score schema version
feature extractor version
before vector
after vector
delta vector
suite summary
compiler revision or baseline label
```

Baseline updates should be explicit:

```text
bun run optimization:score -- --update-baselines
bun run optimization:score -- --update-baselines --reason optimizer-change
bun run optimization:score -- --rebaseline-score-schema --reason scorer-change
```

Reviewing a baseline update should feel like reviewing a snapshot change:

- Which cases improved?
- Which cases regressed?
- Which bucket moved?
- Is the movement expected for the optimization being developed?

Scorer changes are different from optimizer changes. If the feature extractor,
weight profile, fixed-point arithmetic, or aggregation formula changes, the
report must mark the old baseline as schema-stale rather than pretending the
optimizer moved.

```text
optimizer changed:
  compare before/after score movement normally

score profile changed:
  require score-profile review
  report old and new suite scores under both profiles when possible

feature extractor changed:
  require extractor-version bump
  mark baseline invalidated by scorer change

baseline updated:
  record reason and changed schema/profile/extractor ids
```

This keeps the scorecard from becoming a one-command rubber stamp. A baseline
diff should explain whether code got faster-looking, the ruler changed, or
both.

## Repository Shape

The scorecard should live at compiler edges and test edges, not in the runtime
compiler core:

```text
tests/
  optimization/
    scorecard/
      optimization-score-runner.ts
      optimization-score-profile.ts
      score-number.ts
      score-report.ts

      opt-ir/
        opt-ir-score.ts
        opt-ir-score-vector.ts
        opt-ir-fixture-capture.ts

      register/
        register-score.ts
        register-score-vector.ts
        register-fixture-capture.ts

      fixtures/
        packet-parser.fixture.ts
        bounds-check-elim.fixture.ts
        coalescing.fixture.ts
        spill-policy.fixture.ts

      baselines/
        generic-aarch64-scorecard.json

scripts/
  optimization-score.ts
```

The scorer may import compiler model types, fixture builders, and test support
helpers. Runtime compiler source should not depend on the scorecard.

## Ablation And Policy Evaluation

The scorecard determines whether optimizations are good by comparing compiler
policies across the representative suite.

Let:

```text
S(policy, suite) =
  suite_score produced by compiling all suite cases with policy
```

Lower is better. The marginal benefit of enabling optimization `o` on top of a
base policy `B` is:

```text
marginal_benefit(o | B) =
  S(B, suite) - S(B + o, suite)
```

Interpretation:

```text
marginal_benefit > 0:
  enabling o improved the suite

marginal_benefit = 0:
  enabling o was neutral

marginal_benefit < 0:
  enabling o regressed the suite
```

The same formula works for register optimizations:

```text
marginal_benefit(register_coalescing | approved_register_policy_without_it)
marginal_benefit(rematerialization | approved_register_policy_without_it)
marginal_benefit(spill_heuristic_threshold_12 | threshold_8_policy)
```

Interactions are measured explicitly:

```text
interaction_benefit(a, b | B) =
  marginal_benefit(a | B + b)
  - marginal_benefit(a | B)
```

Interpretation:

```text
interaction_benefit > 0:
  b makes a more valuable

interaction_benefit = 0:
  a and b are roughly independent under this suite

interaction_benefit < 0:
  b makes a less valuable or redundant
```

This lets developers ask precise questions:

```text
Does coalescing still help after rematerialization?
Does bounds-check elimination make register pressure worse?
Does copy propagation help only when the later register pipeline can coalesce?
Which spill threshold is best for call-heavy fixtures?
```

Ablation reports should show both scalar movement and bucket movement:

```text
register_coalescing ablation

Suite:
  without:  9120.00
  with:     8610.00
  benefit:  +510.00 (+5.59%)

Buckets:
  copies:       -780.00
  spills:       +140.00
  frame:         +20.00
  dependency:   +110.00

Conclusion:
  net improvement, but coalescing is creating spill pressure in two fixtures
```

The scorecard can support several policy-evaluation runs:

```text
single ablation:
  compare approved policy with one optimization disabled or enabled

threshold sweep:
  run the same policy with a range of heuristic thresholds

pairwise interaction:
  evaluate two optimizations together and separately

pass-order comparison:
  compare selected pass orders for a bounded group

register-policy comparison:
  compare allocator, coalescing, spill, and rematerialization policy variants
```

These runs are intentionally offline. Their output informs human-reviewed
compiler policy changes.

## Policy And Scorecard Concordance

The local compile-time policies and the scorecard are separate systems, but
they must not drift into unrelated vocabularies.

Each local policy should declare which score buckets it expects to influence:

```ts
export interface LocalPolicyScoreConcordance {
  readonly policyId: string;
  readonly decisionKinds: readonly string[];
  readonly expectedPrimaryBuckets: readonly ScoreBucketPath[];
  readonly expectedRiskBuckets: readonly ScoreBucketPath[];
}
```

Examples:

```text
bounds-check-elimination-policy:
  primary buckets:
    optIr.runtimeChecks
    optIr.factUse
  risk buckets:
    optIr.control
    optIr.registerability

coalescing-policy:
  primary buckets:
    register.copies
  risk buckets:
    register.spills
    register.dependency
    register.allocation
```

Scorecard reports should correlate decision logs with score movement:

```text
policy_decision_count(policy, case)
score_delta(bucket, case)
bucket_per_decision_delta =
  score_delta(bucket, case)
  / max(policy_decision_count(policy, case), 1)
```

The goal is not to prove causality. The goal is to catch divergence:

```text
policy says it removes bounds checks
scorecard shows runtimeChecks unchanged
=> investigate extractor, fixture, or policy

policy says coalescing reduces copies
scorecard shows copies down but spills sharply up
=> inspect risk bucket movement

policy says noalias facts enabled motion
scorecard shows no factUse movement
=> inspect decision log and fact extractor
```

Concordance checks should run in scorecard mode, not production compilation.
They keep the "approved policy internals" and offline scorecard aligned without
turning the scorecard into compile-time authority.

## Future Offline Search

The scorecard creates the foundation for later search without forcing search
into production compilation.

A future search command can evaluate:

- pass order
- pass enablement
- optimization thresholds
- register spill heuristics
- coalescing heuristics
- rematerialization thresholds
- inlining and unrolling policies

Search objective:

```text
objective(configuration) =
  suite_score(configuration)
  + worst_regression_gate(configuration)
  + expectation_failure_penalty(configuration)
  + compile_time_penalty(configuration)
  + code_size_penalty(configuration)
  + instability_penalty(configuration)
  + benchmark_mismatch_penalty(configuration)
```

Exhaustive search is appropriate only for tiny bounded spaces. Larger spaces
should use beam search, random search, Bayesian search, or ML-guided proposal.
All of those remain offline.

The output is not an automatic compiler change. It is a recommendation:

```text
recommended policy:
  enable bounds_check_elim before copy_prop
  run coalescing after rematerialization
  set spill_hot_reload_weight to 12

evidence:
  suite score improved 8.7%
  packet parser improved 17.2%
  call-heavy fixture regressed 1.1%
```

## Search Guardrails

Once `suite_score` becomes an optimization target, it can be overfit. The
scorecard must therefore treat automated search results as recommendations,
not truth.

Guardrails:

- Do not auto-ship a policy because `suite_score` improved.
- Cap positive score credits more aggressively than regressions.
- Report worst-case regression separately from mean movement.
- Keep held-out scorecard cases that search does not tune against.
- Prefer Pareto reports over one scalar when tradeoffs are visible.
- Require human review of bucket movement, expectation failures, code size, and
  compile-time cost.
- Use real benchmark anchors whenever available.
- Treat benchmark disagreement as a first-class search penalty.

Benchmark anchor format:

```text
benchmark_anchor:
  fixture: packet-parser
  metric: emulator_cycles | hardware_cycles | instruction_count | code_size
  expected_direction: decrease
  confidence: measured | emulator | proxy
```

Search reports should include both scorecard movement and benchmark movement:

```text
policy candidate: coalescing-after-rematerialization

Scorecard:
  suite score: -8.7%
  worst regression: +1.1%
  expectation failures: 0

Benchmark anchors:
  packet-parser emulator cycles: -5.9%
  call-heavy instruction count:  +0.4%

Review status:
  recommendation only
```

If no benchmark anchors exist, the report must say so plainly. A score-only
recommendation can still be useful, but its confidence is lower.

## ML Use

ML can be useful once the scorecard has enough stable data.

Allowed uses:

- predict promising pass orders for offline search
- recommend heuristic thresholds for human review
- cluster fixtures by optimization behavior
- identify score buckets that often predict benchmark regressions

Disallowed uses:

- replacing deterministic score formulas
- making compile-time optimization decisions without ordinary compiler policy
- changing production behavior based on host-local training

The deterministic score report is the label source for score prediction. Real
benchmark results are the calibration source for performance claims. If a
search or ML recommendation has no benchmark anchor, the report must label it
as score-only evidence.

## Validation

The scorecard infrastructure should have ordinary tests:

- fixed-point arithmetic is deterministic
- bucket aggregation is canonical
- lower scores compare as improvements
- relative deltas use `relativeScoreFloor`
- positive-credit capping and worst-regression penalties work for suite
  aggregation
- reports are stable
- expectations classify info, warning, and failure correctly
- input shapes are reported separately before suite aggregation
- local policy decision logs preserve facts, alternatives, and feature vectors
- OptIR scoring is monotonic for simple feature changes
- register scoring is monotonic for added spills, reloads, moves, and stack
  slots
- AArch64-shaped register classes are counted separately
- register stability probes report allocation churn and score variance
- policy/scorecard concordance reports expected bucket movement
- benchmark-anchor absence is labeled as score-only evidence
- score schema, feature extractor, and profile changes invalidate or rebaseline
  baselines explicitly
- baseline update output is deterministic

The expensive representative corpus is not part of normal `agent:check`.

## Design Defaults

- Call the subsystem `OptimizationScorecard`.
- Use `OptIrScore` for offline OptIR before/after comparison.
- Use `RegisterScore` for offline register-selection before/after comparison.
- Treat scores as abstract points, not cycles.
- Keep lower-is-better semantics.
- Keep score vectors and explanations as the diagnostic truth.
- Keep representative score runs opt-in.
- Keep production compile-time optimization independent from scorecard
  authority, but allow bounded local policy heuristics.
- Require local policy decision logs in debug and scorecard runs.
- Keep local policy feature vocabulary aligned with scorecard buckets through
  concordance checks.
- Keep AArch64 as the first concrete register-profile shape.
- Report input shapes separately when optimization behavior is input-sensitive.
- Cap score credits more aggressively than regressions and report worst-case
  regressions separately.
- Report allocation churn and register-score stability for register-policy
  comparisons.
- Treat baseline updates, score-profile changes, and feature-extractor changes
  as different review events.
- Keep future brute-force and ML search offline.
- Require search recommendations to disclose whether benchmark anchors exist.
- Use scorecard results to improve compiler policy through human-reviewed
  changes, not automatic compile-time toggles.
