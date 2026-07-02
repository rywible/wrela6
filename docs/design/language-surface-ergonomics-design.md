# Language Surface Ergonomics Design

## Purpose

This document specifies a set of language surface changes whose shared goal is
to move the visible cost of Wrela's resource model to the edge layer, where the
model is rare and load-bearing, and to make ordinary application code read and
write like structured code. The trust architecture is unchanged: sealed tokens,
edge classes, implicit brands and sessions, validated buffers, bounded static
memory, the MoveRing/pin concurrency model, whole-image closure, and the
terminal-to-platform discharge chain are all preserved exactly as specified in
`docs/language/happy.md` and `docs/language/invalid.md`. Every change below is
either a subtraction (fewer declared kinds, fewer wrapper types), a default
(compiler-inserted discharge at statically known points), or a diagnostics
surface (named facts with lineage traces). One change (payload-carrying enum
states) extends an existing construct using rules the language already has.

The motivating observation: the current happy-path example requires roughly 150
lines of preamble rules to explain a 400-line program, and the single most
common obligation the model imposes on application authors — "if I did nothing
special with this token, give it back" — is priced identically to the rare case
where a genuine decision is being made. These proposals reprice the rote case
without weakening any checked guarantee.

Seven proposals are normative in this document:

1. Default discharge: edge-declared default terminals, per token type.
2. Payload-carrying enum states: typed state machines with per-state data.
3. Function-kind reduction: checked properties replace declared kinds.
4. Fallible-affine unification: one `Result` rule replaces `Validation` and
   `Attempt` as distinct wrapper types, with signature-visible retention.
5. Named facts and entailment traces: a diagnostics contract for proof
   failures.
6. Module profiles: an enforced app/proto/edge language split.
7. Small ergonomics: saturating compound assignment and keyword-argument
   relaxation.

One additional proposal, flows (compiler-compiled state machines /
generators), is explicitly deferred with evidence gates; see "Deferred:
Flows".

## Goals

- Reduce the number of construct kinds an application author must know before
  reading `PacketCounter`-class code, without removing any checked rule.
- Make `?`, early `return`, `break`, and `continue` legal in the common case
  where a live obligation has a declared default discharge.
- Give multi-tick state machines typed per-state data so state validity
  invariants move from comments into the type system, and so affine values may
  be legally retained across ticks inside state payloads under the existing
  resource-kind lifting rule.
- Replace declared function kinds with properties the checker derives from
  signatures and bodies, keeping exactly one trust keyword: `platform`.
- Collapse `Validation[Ok, Err, Source]` and `Attempt[Ok, Err, Inputs]` into a
  single typing rule over `Result`, removing two special-case wrapper types.
- Specify the user-facing shape of proof-failure diagnostics as a contract,
  reusing the fact lineage machinery that already exists in the checker and
  optimizer (`fact-lineage`, decision logs, explanation records).
- Enforce the edge/app layering as a module-level language mode rather than a
  documentation convention.

## Non-Goals

- No change to the trusted computing base. Platform functions remain the only
  trusted hardware boundary; default terminals are ordinary checked terminal
  code written by edge authors.
- No ambient drop, destructor, or GC semantics. Default discharge is a
  compiler-inserted call to a named terminal at a statically known program
  point, recorded in provenance like a hand-written call. The prohibitions in
  `invalid.md` ("Forbidden Runtime Escape Hatches") are unchanged.
- No closures, no dynamic dispatch, no recursion, no unbounded memory. Nothing
  in this document relaxes the static memory or whole-image monomorphization
  contracts.
- No commitment to flows/generators in this document. Section "Deferred: Flows"
  records the design direction and the evidence that would trigger it, and
  nothing more.
- No source-compatibility guarantee with existing `.wr` fixtures; this is a
  pre-1.0 surface change. Migration notes are included per section.

## Design Principle

A rule should be _declared_ in source only when the declaration carries
information the compiler cannot derive, or when the declaration marks a trust
boundary a human auditor must be able to find. Everything else should be a
checked property with a precise diagnostic. The current surface violates this
principle in both directions: it demands declarations that restate the
signature (`terminal`, `predicate`, `constructor`), and it provides no
declaration surface for the one thing authors genuinely need to say rarely and
audit easily (what happens to an unconsumed token).

## Proposal 1: Default Discharge

### Surface

An edge class or stream may nominate at most one of its terminal functions as
the default discharge for a token type it yields or mints:

```wr
stream RxBatch contains ReadableBuffer bound 64:
    default terminal fn release_rx(self, buffer: ReadableBuffer):
        self.publish_buffer_rx(buffer=buffer)

    terminal fn return_rx(self, packet: Packet):
        self.publish_packet_rx(packet=packet)
```

The `default` modifier is legal only on a terminal function whose non-self
parameter list is exactly one consumed token of the covered type and nothing
else. The covered type is the parameter's type. At most one default terminal
per (edge path or stream, token type) pair is legal; a second declaration is a
compile error. Optional non-token parameters (for example a rejection reason)
are deliberately excluded from v1: an edge that wants a reason on the default
path writes a dedicated zero-extra-parameter terminal that bakes the reason in
and delegates. Relaxing this to declared-default extras is possible later
without breaking existing declarations; the restriction is the conservative
starting point.

Syntax staging: the example above shows the v1 surface, while `terminal`
remains a declared kind. After Proposal 3 lands, the `terminal` keyword is
removed and terminality is derived, so the final surface is:

```wr
    default fn release_rx(self, consume buffer: ReadableBuffer):
        self.publish_buffer_rx(buffer=buffer)
```

The `default` modifier itself is unaffected by Proposal 3; only the redundant
kind keyword disappears. This staging is why Proposal 1 precedes Proposal 3 in
the implementation order.

### Semantics

When a value of a covered token type reaches the end of its scope — normal
fall-through, early `return`, `?`, `break`, `continue`, or terminal discharge
of a _different_ obligation that closes the enclosing session — without having
been consumed, the compiler inserts a call to the default terminal at that exit
point. Insertion is static and deterministic: each scope exit has exactly one
insertion site, insertion order for multiple covered tokens exiting one scope
is reverse declaration order, and inserted calls precede session close for the
enclosing `take` scope. Inserted calls are ordinary terminal calls: they carry
the same brand/session checks, route through the same platform chain, and
appear in checked MIR, provenance records, and fact lineage identically to
hand-written calls, distinguished only by an `inserted: defaultDischarge`
origin tag for audit and diagnostics.

The obligation-crossing rule from `happy.md` ("`?`, `return`, `break`, and
`yield` cannot cross a live linear obligation unless the obligation is carried
out by the result type or discharged first") gains one arm: "...or the
obligation's token type has a default terminal in scope, in which case the
compiler discharges it at the crossing point." Tokens without a default remain
fully linear with the existing rule; nothing about them changes.

`yield` (scheduler borrow) remains illegal while any linear obligation is
live, including defaulted ones. Default discharge covers scope _exit_, not
suspension; a tick must still fully drain or explicitly retain its tokens
before yielding. (If flows are later adopted, frame-carried retention is the
mechanism for suspension, not default discharge; see Deferred: Flows.)

### What may and may not carry a default

The edge author chooses per token type, and the choice is the safety analysis:

- Receive-shaped tokens (RX buffers, completions), where a forgotten discharge
  means a leaked descriptor, should declare defaults. The default deletes the
  leak bug class: there is no ownership-unsafe outcome, because the descriptor
  provably returns to the queue on every path. It can still mask an intent
  bug — an early `return` that skips a packet the author meant to handle now
  releases it silently instead of failing to compile. That residual risk moves
  from the type system to the audit surface: the inserted-discharge table and
  the `#[explicit_discharge]` attribute exist precisely so intent-sensitive
  code can keep the explicit style.
- Transmit-shaped and decision-shaped tokens (a claimed `WritableBuffer`, a
  machine plan), where a forgotten discharge is a logic error, should not
  declare defaults and remain fully linear. `NetworkTx` in the reference
  design declares no default.

The language does not enforce this taxonomy; it gives the edge author the one
line needed to express it. Core code cannot declare defaults for sealed types
it does not own (sealing already prevents this).

### Checking

Proof and resource checking treats an inserted discharge exactly as a source
call for loans, brands, sessions, private-state threading, and terminal
closure. The terminal-closure judgment is unchanged: the default terminal must
be acyclic and reach a platform function. The checker verifies at declaration
site that the default terminal is callable in every context where the covered
token can be live (same edge path, same session shape); if the terminal
requires facts that are not guaranteed at every possible exit (for example a
`requires` clause over token fields), the declaration is rejected with the
missing entailment, since a default that can fail to typecheck at an implicit
site is worse than no default.

### Diagnostics And Audit

Every inserted discharge is reported in a per-function table available to
tooling (`inserted-discharges: token, type, exit site, terminal`). A
module-level strictness attribute (`#[explicit_discharge]`) turns insertion
sites into errors for teams or files that want the fully explicit style; the
attribute changes diagnostics only, never semantics.

### Migration

`tick()` in `happy.md` drops the `drop_rx` arm's explicit call; `return_rx`
paths are unchanged. `invalid.md` gains a section distinguishing forbidden
ambient discharge (GC, refcounting — still rejected) from declared default
discharge, and the "closing in helper after validation" family of examples is
re-audited against the new crossing-rule arm.

## Proposal 2: Payload-Carrying Enum States

### Surface

Enum variants may declare typed payloads:

```wr
enum DhcpState:
    idle
    discover_sent(retries: u8, deadline: Tick)
    request_sent(offer_ip: u32, deadline: Tick)
    bound(lease: Lease)
```

Construction uses call syntax (`discover_sent(retries=0, deadline=t)`); `match`
binds payload fields by name. Payload types follow dataclass field rules with
one deliberate difference stated next.

### Resource-Kind Lifting

Unlike dataclasses (which reject affine fields), enum variants lift resource
kind exactly as `Option`, `Result`, tuples, and collections already do under
the existing type-constructor lifting rule: an enum with any affine or linear
payload field is itself affine or linear. This is the intended mechanism for
retaining an obligation across ticks: a `WritableBuffer` stored in a state
variant makes the whole state value affine — it cannot be copied, silently
dropped, or stored in a copy-safe aggregate, and abandoning it requires
discharging the contained obligation (via `match` + explicit terminal, or via
a default terminal under Proposal 1). Session-bound values (live stream items,
validated buffers, edge-internal proof tokens) remain non-storable exactly as
today; the lifting rule does not override session rules. Whether a given
sealed token type may be retained across ticks at all remains a property of
the token type declared by its edge (a `retainable` bit on the sealed type),
so the edge keeps authority over descriptor lifetimes.

### State Threading

The recommended application shape is transition-by-construction:

```wr
fn tick_dhcp(self, consume state: DhcpState) -> DhcpState:
```

consuming the previous state and constructing the next. This is the same
consume-and-activate discipline the language already checks for private
classes, applied to an ordinary enum with no new checker machinery: `consume`
parameters, exhaustive `match`, and lifting already exist. Per-state data
means a field like `offer_ip` is inaccessible outside the states that carry
it, moving state-validity invariants from comments into types, and transition
construction makes forgotten counter resets unrepresentable.

### Checking And Layout

Exhaustiveness checking extends to payload-carrying variants (already required
for `Validation` matches). Layout: tagged union with per-variant field layout,
sized by the maximal variant; representation-layout facts gain a variant map
so opt-ir can narrow loads after a tag test (the existing branch-fact →
compare-folding path applies unchanged).

### Migration

Bare enums are unchanged. `Option`, `Result`, `Validation`, and `Attempt`
become expressible as ordinary payload enums plus rules, which Proposal 4
exploits.

## Proposal 3: Function-Kind Reduction

### Surface

The declared kinds `predicate fn`, `terminal fn`, and `constructor fn` are
removed. `platform fn` remains, as the single keyword marking the trusted
boundary. `fn` is the only other function form.

### Checked Properties Replace Declared Kinds

- Purity (former `predicate`): a `fn` used in a `requires` clause or other
  proof position must satisfy the existing predicate rules (no mutation, no
  platform operations, no affine consumption, no unstable device state). The
  checker verifies these by analysis of the body; the _use site_ (appearing in
  proof position) is what triggers the requirement, not a declaration. The
  existing rule that predicate facts bind to the exact state token they were
  proven on is unchanged.
- Terminality (former `terminal`): a `fn` is terminal-checked for a consumed
  sealed obligation exactly when the obligation _disappears_ inside it — it is
  neither returned, nor carried in the result type, nor retained in reachable
  state (including payload-enum state under Proposal 2). A disappearing
  obligation must have gone to hardware, so the terminal rules apply: acyclic
  control flow, every path discharges into a platform fn or another
  discharging fn that reaches one. Consuming a sealed token is therefore not
  sufficient by itself: `fn stash(self, consume buffer: WritableBuffer) ->
DhcpState`, which stores a retainable token into a state payload, is an
  ordinary function, not a terminal one. The disappearance test reuses the
  obligation escape analysis the checker already performs for crossing rules;
  no new machinery is required. Stream/edge terminal dispatch rules (which
  tokens a method may close) key off the same signature facts they key off
  today.
- Construction (former `constructor`): a `fn` returning `Self` follows the
  existing constructor consumption rules for affine arguments stored into the
  constructed object; again derived from the signature.

Tooling note: documentation generators and editors should render the derived
badges (pure / discharging / constructing) so the information remains visible
to readers even though it is no longer written.

### Transitional Assertion Annotations

During a deprecation window, `terminal` and `predicate` remain legal as
optional assertion annotations rather than kinds: writing them asserts that
the checker derives the corresponding property, and the program is rejected at
the _declaration_ site if it does not (analogous to a checked `#[must_use]`
claim). This catches derived-property drift where the author wants it caught —
at the function — instead of at a distant use site, and gives existing code a
migration path that is delete-only rather than rewrite. The annotations carry
no semantics beyond the assertion; whether they are removed after the window
or kept indefinitely as documentation-grade assertions is left open (see Open
Questions).

### Rationale And Cost

This removes three of the five function kinds from the taught surface with no
change to what is checked. The cost is that a body edit can change a derived
property and surface an error at a _use_ site rather than the declaration
site; the diagnostics contract (Proposal 5) therefore requires such errors to
name both sites ("`can_insert` is used as a proof predicate at packet.wr:212
but mutates `self.cursor` at builder.wr:88"), and the transitional assertion
annotations above let authors pin the property at the declaration when they
want the drift caught locally.

## Proposal 4: Fallible-Affine Unification

### Surface

`Validation[Ok, Err, Source]` and `Attempt[Ok, Err, Inputs]` are removed as
distinct types. `Result[Ok, Err]` (a payload enum under Proposal 2) is the
single fallible shape, governed by one typing rule:

Fallible-affine rule: a call that consumes affine or linear inputs and returns
`Result[Ok, Err]` typechecks only if every input is, on the `Ok` arm, consumed
into `Ok`'s payload or discharged by the callee, and on the `Err` arm, either
returned inside `Err`'s payload, retained by the callee's receiver, or
discharged by the callee. `?` is legal exactly when the surrounding function's
result type carries the same obligations the `Err` payload carries (the
existing visibility rule, unchanged in substance).

### Signature-Visible Retention

The rule above makes error-path disposition _checkable_; this section makes it
_readable_. A consumed affine input's Err-arm disposition must be visible in
the function signature, in one of exactly two forms: the `Err` payload
literally carries the token type, or the signature declares a retention
clause naming the parameter:

```wr
fn validate(consume source: ReadableBuffer, limits: PacketLimits)
    -> Result[Packet, PacketReject] retains source
```

`retains source` states that on `Err` the named input remains live in the
caller's enclosing scope (for session-bound sources, the enclosing `take`
scope). A fallible signature that consumes an affine input and exhibits
neither form is rejected at declaration. This restores the one genuinely
useful property of the former `Validation[Ok, Err, Source]` spelling — the
retention contract was in the type — without reintroducing the wrapper type:
callers at module boundaries can read the obligation summary from the
signature alone, and the checker verifies the body against the declared
disposition rather than inferring one.

Validated-buffer validators become ordinary generated functions with exactly
the signature shown above — the retention case of the rule, not a special
type. The single-use, must-match-in-scope behavior of the former `Validation`
follows from the session brand on the source plus lifting: the result value
containing (or licensed against) a session-bound source cannot be stored,
returned, or outlive the scope, because those rules already govern the source
itself.

### Rationale

Two wrapper types encoded one rule ("errors give affine inputs back") with
subtly different surfaces, and each future fallible-affine pattern risked a
third. One rule on one type ends the proliferation, and the reference example
loses two of its most confusing preamble paragraphs.

## Proposal 5: Named Facts And Entailment Traces

### Surface

`ensure` statements and `requires` clauses may bind names:

```wr
ensure len_ok: len <= buffer.capacity else return
requires fits: layout.fits
```

Names are per-function, proof-surface-only identifiers (they do not exist at
runtime and do not collide with value names).

### Diagnostics Contract

When a `requires` clause fails to entail, the diagnostic must contain, in
order: (1) the failing obligation with source span; (2) the named facts that
were in scope on the failing path, each with the span that established it; (3)
for any fact that _was_ established on the path but died before the call, the
exact statement that invalidated it (state-token advance, session close,
memory edit) — "fact `len_ok` (line 31) was invalidated by `self.advance()`
at line 40 because predicate facts bind to the exact private state they were
proven on"; and (4) when the entailment gap is a single missing comparison,
the minimal suggested `ensure`. The checker's existing lineage records
(checked dependencies per fact, path certificates, decision logs) already
contain (2) and (3); this proposal makes rendering them a conformance
requirement with golden-file tests rather than an internal capability.

Counterexample paths in proof diagnostics must be reported in idiom
vocabulary: crossing violations name the token and the exit ("`buffer` must be
sent or released before `return` at line 12"), never internal calculus terms
(obligation IDs, brand keys) except under a verbose flag.

## Proposal 6: Module Profiles

### Surface

Every module declares (or defaults to) a profile:

- `app` (default): may use classes, dataclasses, payload enums, interfaces as
  bounds, `fn`, `take`, `Result`, bounded collections, MoveRing endpoints, and
  sealed tokens _as received values_. May not declare edge classes, unique
  edge classes, streams, validated buffers, private classes, platform fns, or
  default terminals, and may not name sealed edge-internal types.
- `proto`: everything in `app`, plus validated buffer declarations and
  retainable-token retention in payload-enum state. May not declare edge
  classes, unique edge classes, streams, private classes, platform fns, or
  default terminals.
- `edge`: the full language.

The `proto` tier exists because validated buffers are schema declarations —
fully checked code with zero trust content — and packet-format/protocol
libraries (a DHCP schema, a TFTP schema) are exactly what app-adjacent authors
should write. Without the middle tier, declaring a packet layout would require
the `edge` profile, handing out platform-declaration rights to obtain layout
declarations and defeating the purpose of the split.

Profiles are enforced by semantic surface checking, not convention. Sealing
already prevents app code from minting tokens; profiles additionally prevent
non-edge modules from _declaring_ boundary machinery, which makes the layered
documentation split ("wrela" / "wrela-proto" / "wrela-edge") a checkable
property and gives diagnostics a hook ("`stream` declarations require an
`edge` module").

Image modules (`uefi image`) are a fourth, existing shape and are unchanged.

## Proposal 7: Small Ergonomics

- Saturating and wrapping compound assignment: `self.ping_count +|= 1`
  (saturating), `+%=` (wrapping), desugaring to the existing `u64` intrinsic
  calls. Counter updates are the most-read lines in application code and
  currently the worst.
- Keyword-argument relaxation: calls to functions with exactly one non-self
  parameter may pass it positionally. Multi-parameter calls keep mandatory
  keywords (the right default for driver APIs).
- These are sugar only: no new semantics, no checker changes beyond desugar.

## Deferred: Flows

Flows — resumable functions whose suspension frames are compiler-generated,
statically sized state structs — are the sequence-shaped complement to
Proposal 2's event-shaped machines. They are deferred, not rejected. The
design direction, recorded so future work does not relitigate it:

- A flow compiles to a _visible_ payload enum (Proposal 2 form): states are
  nameable via labels on each suspension point, the current state is
  inspectable for logging, and documentation can render the derived state
  diagram. The flow is a projection over an auditable machine, not hidden
  control flow.
- The frame is a statically sized value stored in the owning worker, obeying
  all static-memory rules; recursion among flows is rejected by the existing
  SCC policy, making frame sizing decidable.
- The obligation-crossing rule extends to suspension: a live obligation may
  cross a suspension point only if it is stored in the frame and its token
  type is retainable (Proposal 2's `retainable` bit); otherwise it must be
  discharged (explicitly or by default terminal) before suspending.
  Cancellation is typed: a suspended frame holding obligations is affine and
  must be terminally discharged to be abandoned.
- Each suspension names the capability it waits on (wake, timer path); the
  image loop remains the only executor.

Evidence gates for promotion to a normative design: implement Proposals 1–2,
write the second and third reference applications (a DHCP client and a TFTP
update flow) as explicit payload-enum machines against the intended stdlib
surface, and measure (a) states per logical operation, (b) duplicated
timeout/retry arms, and (c) obligation-threading errors encountered during
authoring. If sequence-shaped control-plane logic remains the dominant source
of (b) and (c), flows are justified; if payload enums absorb the pain, they
are not.

## Interactions And Rule Changes Summary

| Existing rule (happy.md)                                          | Change                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?`/`return`/`break`/`yield` cannot cross live linear obligations | New arm: crossing is legal for tokens with an in-scope default terminal; compiler inserts discharge at the crossing point. `yield` still requires no live obligations. |
| Type constructors lift resource kind                              | Extended verbatim to payload enum variants; dataclasses still reject affine fields.                                                                                    |
| Terminal fn control flow acyclic, must reach platform             | Unchanged; now triggered by obligation disappearance (consumed sealed token neither returned, result-carried, nor retained) instead of keyword.                        |
| Predicate fn purity and exact-state binding                       | Unchanged; triggered by proof-position use instead of keyword.                                                                                                         |
| Validation/Attempt wrapper rules                                  | Replaced by the single fallible-affine rule over `Result`, with Err-arm disposition required to be signature-visible (payload-carried or `retains` clause).            |
| Sealed token minting restricted to edges                          | Unchanged; module profiles additionally restrict _declarations_ to proto/edge modules by construct.                                                                    |

## Determinism

Inserted discharge sites, insertion order (reverse declaration order per
scope), derived function properties, profile checks, and diagnostic rendering
are all deterministic functions of the source and are covered by the existing
determinism discipline: identical inputs produce byte-identical diagnostics,
provenance records, and checked MIR.

## Testing Strategy

- Golden checked-MIR tests: for each crossing construct (`?`, `return`,
  `break`, `continue`, session close), a fixture with and without a default
  terminal, asserting exact insertion sites and order.
- Negative fixtures extending `invalid.md`: default terminal with any
  parameter beyond the single consumed token (reject), two defaults for one
  token type (reject), default whose `requires` is not entailed at every exit
  (reject with named entailment gap), affine payload enum stored in a
  dataclass (reject), retention of a non-retainable token in a state payload
  (reject), fallible signature consuming an affine input with neither
  payload-carried nor `retains`-declared Err disposition (reject), `retains`
  clause whose body discharges the named input on Err (reject), app-profile
  module declaring a stream or validated buffer (reject), proto-profile
  module declaring a platform fn (reject), impure fn used in proof position
  (reject, dual-site diagnostic), `terminal` assertion annotation on a fn
  whose consumed obligation is retained in state (reject at declaration).
- Positive fixture for the terminality derivation: a fn consuming a
  retainable sealed token into a payload-enum state variant is accepted as an
  ordinary function (not terminal-checked), and the same fn with the
  retention removed becomes terminal-checked and is rejected if it fails to
  reach a platform fn.
- Equivalence tests for Proposal 4: every `Validation`/`Attempt` fixture in
  the current suite re-expressed as `Result` under the fallible-affine rule,
  with identical accept/reject outcomes.
- Diagnostics conformance: golden-file tests for the Proposal 5 rendering
  contract, including at least one fact-death trace across a private-state
  advance.
- Reference program: `happy.md` rewritten under Proposals 1–4 and 7, with a
  preamble-line-count assertion in review (target: under half the current
  rule preamble) and byte-identical emitted image versus the explicit form
  (default discharge must be a source-level convenience, not a codegen
  change).

## Suggested Implementation Order

1. Proposal 7 (sugar) and Proposal 5's named-fact syntax: parser and
   surface-checker only; low risk, immediately improves every later fixture.
2. Proposal 2 (payload enums): parser, HIR, layout facts, exhaustiveness,
   lifting. Prerequisite for Proposal 4 and the flow evidence program.
3. Proposal 1 (default discharge): surface, proof-resource crossing-rule arm,
   insertion in MIR construction, provenance tagging, audit table. This is
   the highest-leverage item in the document; its narrowed v1 scope
   (single-token signatures) exists to keep it early in the order, not to
   justify deferring it behind lower-risk proposals.
4. Proposal 4 (Result unification): retire the wrapper types and add the
   `retains` clause; mechanical once Proposal 2 lands.
5. Proposal 3 (kind reduction): surface removal, derived-property analyses
   (including the obligation-disappearance terminality test), and the
   transitional assertion annotations; schedule after 1, 2, and 4 so terminal
   derivation lands against the final signature and retention rules.
6. Proposal 6 (module profiles): surface checking pass over the finished
   surface.
7. Evidence program for flows: DHCP and TFTP reference applications, then a
   go/no-go against the gates in "Deferred: Flows".

## Resolved Questions

- Default terminal parameters: resolved conservative. V1 default terminals
  take exactly one consumed token and nothing else; edges wanting a reason on
  the default path write a delegating terminal with the reason baked in.
  Declared-default extras remain a compatible future relaxation.
- Profile granularity: resolved in favor of the three-tier split. `proto`
  (validated buffers + retainable-token state, no boundary declarations) is
  normative in Proposal 6; without it, protocol/schema libraries would be
  forced into `edge` and the split would leak platform-declaration rights.

## Open Questions

- Retainability: is the `retainable` bit per sealed type sufficient, or do
  edges need per-path retention budgets (at most N descriptors held across
  ticks) to protect queue depth? Budgeted retention interacts with bounded
  collections and needs its own note if pursued.
- Transitional assertion annotations (`terminal`, `predicate` as checked
  claims): removed after the deprecation window, or kept indefinitely as
  documentation-grade assertions? Keeping them costs one modifier and gives
  authors declaration-site drift detection permanently; removing them keeps
  the surface minimal.
- Whether `#[explicit_discharge]` should be settable per-image (build-level
  policy) in addition to per-module.
