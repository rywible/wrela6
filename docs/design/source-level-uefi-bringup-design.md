# Source-Level UEFI Bringup Design

## Purpose

This design moves the PacketCounter full-image fixture from a compact status
and validated-buffer smoke program to a source-level UEFI bringup program. The
fixture should express firmware discovery, virtio network binding, machine
planning, `ExitBootServices`, post-exit machine/device use, and the PacketCounter
loop in ordinary Wrela source, then compile through the production pipeline:
frontend, semantic, HIR, monomorphization, layout facts, Proof MIR,
proof-check, OptIR, AArch64 lowering/backend, linker, and PE/COFF writer.

The goal is not parser acceptance. The target state must retain evidence in
the compiler domains that already feed full-image validation: semantic platform
authority, HIR/proof metadata, Proof MIR, proof-check certificates/facts, OptIR
facts and operations, AArch64 objects, linked layout, and final PE/COFF bytes.

## Audit Summary

### Real Today

- The frontend already parses the target surface syntax used by the fixture:
  `uefi image`, `devices:`, typed function parameters, method calls, named
  arguments, object literals, generic type references such as
  `Result[Never, BootError]`, postfix attempt syntax such as
  `call()? BootError.X`, `let`, `return`, and `loop`.
- Image device declarations exist as generic frontend, semantic, HIR, and layout
  concepts. Unique edge roots and edge paths are resource-kind-aware, and image
  device origins/brands can be recorded.
- Source method calls resolve and lower through HIR. Receiver resource places
  are visible to call lowering and proof metadata.
- Source validation and attempt machinery exists. A certified platform contract
  can attach `attemptContracts`, and source signatures returning an explicit
  `Attempt[Ok, Err, Input...]` can also create attempt metadata.
- The UEFI AArch64 target driver, status ABI bridge, runtime helper objects,
  firmware table call lowering, AArch64 backend, linker, and PE/COFF writer are
  real for the current lower-level UEFI source surface.
- Full-image validation has a real matrix across `toolchain-stdlib`,
  `ejected-stdlib`, and `direct-platform`, plus reference checkers for source
  roots, semantic platform primitives, proof facts, OptIR operations, AArch64
  objects, linked layout, PE/COFF bytes, and UEFI TCB golden data.

### Partial Today

- The PacketCounter fixture is real source loaded through the production import
  discovery path, but it remains the compact `boot() -> UefiStatus` version. It
  does not use `UefiFirmware`, `devices:`, `Machine`, `NetworkDevice`, named
  bringup APIs, or `Result[Never, BootError]`.
- The semantic UEFI image profile currently accepts `boot() -> UefiStatus`
  style entries, not `boot(firmware: UefiFirmware) -> Result[Never, BootError]`.
  The physical entry ABI already has image-handle and system-table arguments,
  but those are hidden target context, not a source-visible firmware capability.
- Platform functions are currently required to be freestanding during name
  binding. Source-visible firmware methods such as `firmware.exit(...)` need
  either certified receiver-method platform binding or source wrappers over
  freestanding certified primitives.
- Attempt checking enforces the right backbone: success may consume declared
  inputs and error must preserve them. It does not yet attach that behavior to
  `Result[Ok, Err]` UEFI APIs unless a certified target contract supplies the
  attempt contract.
- Private-state and phase facts exist as compiler domains, but the UEFI bringup
  phase model is not currently represented. Current UEFI support has low-level
  `ExitBootServices` helper materialization, not source-level pre-exit and
  post-exit capabilities.
- Current local validation is not green: PacketCounter production compilation
  fails in proof-check, and `agent:check` fails typecheck in a proof-check test
  fixture shape.

### Missing Today

- Source-visible `UefiFirmware`, `BootError`, `MachinePlan`, `Machine`,
  `NetworkDevice`, net path capabilities, and virtio discovery/binding API
  definitions across the appropriate stdlib modes.
- UEFI target semantic/device surfaces for the `NetworkDevice` image root and
  for compiler-owned firmware capability seeding.
- Certified UEFI API contracts for:
  `reserve_restricted_memory`, `discover_virtio`, `bind_virtio_net`,
  `plan_machine`, and `exit`.
- Proof MIR/proof-check evidence that the source-level APIs are real calls with
  declared attempt inputs and phase/capability transitions.
- OptIR/AArch64 lowering records for the high-level APIs. Lowering may use
  target-owned runtime helpers or inline/compiler operations, but it must not
  inject test-only OptIR or skip production domains.
- Reference checks proving UEFI firmware/device/capability evidence comes from
  retained compiler domains rather than fixture text alone.
- Negative fixtures/tests for invalid phase use, dropped capabilities on error,
  missing device binding, and invalid post-exit firmware use.

## Source Model

The source model is intentionally small for this fixture. It does not attempt
to implement a complete UEFI driver framework.

```wr
uefi image PacketCounterImage:
    devices:
        net0: NetworkDevice

    private fn bringup(firmware: UefiFirmware) -> Result[Machine, BootError]:
        firmware.reserve_restricted_memory()? BootError.Memory
        let devices = firmware.discover_virtio()? BootError.DeviceDiscovery
        let net0 = firmware.bind_virtio_net(
            device=devices.net0,
            name="net0",
        )? BootError.DeviceUnavailable
        let machine_plan = firmware.plan_machine(
            devices={
                net0: net0,
            },
        )? BootError.MachinePlanFailed
        return firmware.exit(machine_plan=machine_plan)? BootError.ExitFailed

    fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:
        let machine = bringup(firmware=firmware)?
        let paths = machine.devices.net0.split()
        let app = PacketCounter.new(paths=paths)
        loop:
            app.tick()
            app.wait()
```

`UefiFirmware` is an affine pre-exit capability minted by the UEFI image entry.
`MachinePlan` is an affine planned handoff value. `Machine` is the post-exit
capability returned by `exit`. `NetworkDevice` is a unique edge root bound by
firmware discovery and machine planning, then split into affine net paths by
post-exit application code.

The v1 phase model is capability based:

- Before `exit`, source code has `UefiFirmware`.
- `plan_machine` consumes selected device capabilities into `MachinePlan` on
  success.
- `exit` consumes `UefiFirmware` and `MachinePlan` on success and returns
  `Machine`.
- After `exit`, there is no live `UefiFirmware`, so using firmware APIs is a
  use-after-move/proof error.
- `Machine` exposes only post-exit machine/device capabilities.

This is enough to block the requested invalid post-exit use without introducing
a broad private-state typestate system. If later fixtures require ordering such
as "reserve restricted memory must happen before discovery", that should be a
small phase-token fact layered onto `UefiFirmware`, not a parser rule.

## API Contracts

The source return type stays `Result[Ok, BootError]`. Attempt behavior comes
from certified UEFI API contracts, not from replacing the user-facing type with
`Attempt[...]`.

Each fallible UEFI API has an explicit contract:

- `reserve_restricted_memory`: observes `UefiFirmware`; no affine input is
  consumed by success or error.
- `discover_virtio`: observes `UefiFirmware`; returns a source-visible virtio
  inventory whose fields are affine device discovery handles.
- `bind_virtio_net`: observes `UefiFirmware` and consumes the selected virtio
  discovery handle on success; error preserves or reclaims the handle.
- `plan_machine`: observes `UefiFirmware` and consumes supplied
  `NetworkDevice` roots into `MachinePlan` on success; error preserves,
  retains, or reclaims those roots.
- `exit`: consumes `UefiFirmware` and `MachinePlan` on success; error must
  retain, return, reclaim, or discharge both according to a checked contract.

The proof-check rule for `? BootError.X` is the same rule as any other attempt:
declared inputs may be consumed only along the success edge, and the error edge
cannot silently drop them. If an error path returns from the function, function
exit checking must see either no live affine obligations or a result type that
explicitly carries them. The UEFI API contracts should prefer retain/reclaim
semantics on error so the fixture's `?` does not launder lost capabilities.

## Compiler Integration

### Frontend

The frontend needs regression coverage for the exact bringup sample, but it
does not need a new parser feature for the main positive fixture. The only
frontend design drift found in the audit is `pub`: current fixtures use `pub`
as inert syntax, not as a real modifier. This work should avoid relying on
`pub` until visibility is intentionally implemented or rejected.

### Semantic

The UEFI semantic target profile must accept the source-visible entry:

```wr
fn boot(firmware: UefiFirmware) -> Result[Never, BootError]
```

The physical UEFI entry ABI remains target-owned. Semantic checking binds the
source parameter to a compiler-seeded firmware capability, not to a raw firmware
pointer.

The public UEFI APIs should stay ordinary Wrela source as much as possible.
`firmware.exit(...)`, `firmware.plan_machine(...)`, `machine.devices.net0`,
and `NetworkDevice.split()` should be source methods and source data shapes
whose bodies express the policy of the bringup model.

Target-bound `platform fn` declarations should be small constrained edge
handles rather than a shadow target stdlib. The selected target certifies only
the boundary operations that actually touch firmware or hardware and gives those
handles exact contracts for consumed inputs, produced capabilities, phase
preconditions, attempt behavior, and lowering. Source wrappers may repackage
those handles into ergonomic methods, but they cannot weaken the constrained
edge contract or invent capabilities that the edge did not produce.

The current compiler only certifies freestanding `platform fn` declarations, and
the broader compiler design already prefers freestanding platform handles with
ordinary source method wrappers. This work should follow that direction first.
If implementation discovers that the source model genuinely needs private
platform functions inside edge classes, that should be implemented as a
language feature with the same exact-contract certification, not by making
arbitrary receiver methods target primitives.

### HIR And Mono

HIR lowering must preserve:

- the image entry firmware parameter as a resource place,
- receiver/argument resource kinds into call lowering,
- object literal field resource kinds for `devices={ net0: net0 }`,
- attempt alternative expressions such as `BootError.ExitFailed`,
- image device origins/brands for `net0: NetworkDevice`,
- function return kind for `Result[Never, BootError]`.

Monomorphization must carry the same proof metadata and resource-kind facts for
generic `Result`, device map shapes, and method calls.

### Proof MIR And Proof-Check

Proof MIR must lower attempts into usable success/error control flow rather
than parser-only markers. Success edges may consume declared inputs. Error
edges must leave inputs owned, or explicitly prove they were retained,
reclaimed, returned, or discharged by the API contract.

The audit found that current Proof MIR attempt edges record effects, but the
proof-check worklist does not generically reduce those edge effects before
comparing split states. Fixing that is part of the bringup model, because the
UEFI `? BootError.X` paths are only sound if the proof checker sees the same
capability transfer that MIR recorded.

Proof-check must seed image-entry firmware and image-device capabilities from
target/image authority, record source-call summaries for bringup and boot, and
reject:

- using `UefiFirmware` after `exit`,
- using a `NetworkDevice` after successful `plan_machine`,
- returning or crossing `?` while affine inputs are live and uncarried,
- boot returning normally from `Result[Never, BootError]`,
- boot omitting handling for bringup errors.

The existing `src/proof-check/domains/validation.ts` file is over the 1k-line
bar. Proof work in this area should split canonical-place helpers and
validation-arm transfer helpers before adding more behavior.

### OptIR, AArch64, Linker, PE/COFF

The high-level UEFI APIs need target-lowering support even when some operations
compile to target-owned helper calls rather than literal firmware table calls.

Allowed v1 lowering strategies:

- inline compiler operations for pure capability bookkeeping when the operation
  has no runtime effect,
- runtime helper materializations for UEFI bringup operations that must emit
  target-owned code,
- existing firmware-call lowering for lower-level UEFI services.

The lowering path must still produce retained OptIR operations/facts and AArch64
object evidence that full-image reference checkers can inspect. The linker and
PE/COFF writer should remain unchanged unless the emitted object/module shape
requires new relocation or section records.

## Validation Strategy

Full-image validation should keep PacketCounter in the existing three stdlib
modes:

- `toolchain-stdlib`: UEFI source API comes from `stdlib/wrela-std`.
- `ejected-stdlib`: the same API is present under the project ejected stdlib.
- `direct-platform`: direct project source declares the ABI/API module needed
  for the fixture without importing the toolchain stdlib.

Reference checks should be extended to prove:

- the semantic platform catalog certified the constrained UEFI edge contracts,
- the public UEFI methods were compiled from Wrela source wrappers rather than
  direct target-owned receiver primitives,
- image entry firmware capability and image `NetworkDevice` capability were
  seeded from compiler/image authority,
- Proof MIR contains UEFI API call/attempt evidence,
- proof-check retained capability/phase facts and rejected forged equivalents,
- OptIR contains UEFI bringup/device operations from production lowering,
- AArch64 objects include the expected target-owned helper/runtime evidence,
- linked/PE artifacts still satisfy the existing structural checks.

Negative coverage should use real fixtures or test source snippets that run
through the same production phase being asserted. Negative tests must not
inject OptIR or call parser-only helpers.

## Implementation Update

The built PacketCounter fixture keeps the public UEFI model in Wrela source and
uses private freestanding platform functions only as constrained target edges.
The source API is phase-shaped:

- `UefiFirmware.reserve_restricted_memory()` consumes the entry firmware edge
  and returns `UefiMemoryReserved`.
- `UefiMemoryReserved.discover_virtio()` returns `VirtioDiscovery`, carrying a
  binder and discovered device handles.
- `UefiVirtioBinder.bind_virtio_net(...)` returns `NetworkBinding`, carrying a
  machine planner and the bound `NetworkDevice`.
- `MachinePlanner.plan_machine(...)` consumes a complete
  `MachineDeviceBindings` object and returns `MachinePlan`.
- `MachinePlan.exit()` is the only source path to post-exit `Machine`.
- `NetworkDevice.split()` returns post-exit network paths for PacketCounter.

This drift from the sketch avoids a mutable mega-`UefiFirmware` object and lets
ordinary source-visible edge types encode the phase boundary. Invalid phase use
is rejected by member/type resolution, while invalid reuse after the bringup
exit path is rejected by proof-check ownership.

Object literals for checked source types now require every checked field. This
is how missing `net0` bindings are rejected before `plan_machine` can be
lowered. Empty source types such as `Result[Ok, Err]` remain constructible with
`{}`.

Full-image reference checks now require PacketCounter evidence for all retained
compiler domains that expose the UEFI source API: semantic reachable primitive
IDs, proof-check platform precondition facts, and optimized OptIR platform
calls for reserve, discovery, binding, planning, exit, and device split.

## Design Constraints

- Runtime source stays dependency-free.
- Filesystem access stays at compiler/host edges.
- Tests use fakes through dependency injection and do not use mocks.
- Names stay descriptive.
- Implementation should split hot files before crossing or expanding past 1k
  lines.
- The local branch is the working branch; do not create a separate worktree for
  this goal.
