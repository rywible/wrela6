# Releasing

Run release gates locally from a clean checkout. Release verification uses non-skip QEMU and non-skip Lean by default.

| Claim                    | Command                       |
| ------------------------ | ----------------------------- |
| Fast local handoff gate  | `bun run agent:check`         |
| QEMU boot smoke          | `bun run verify:qemu`         |
| Lean proof model         | `bun run verify:lean`         |
| Optimization scorecard   | `bun run verify:scorecard`    |
| Reproducible image build | `bun run verify:reproducible` |
| CLI smoke                | `bun run verify:cli-smoke`    |
| Stdlib conformance       | `bun run verify:stdlib`       |
| Full release gate        | `bun run verify:release`      |

QEMU configuration comes from `WRELA_QEMU_AARCH64`, `WRELA_QEMU_AARCH64_EFI_CODE`, and optional `WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE`. `verify:extended` may skip missing QEMU or Lean for broad local handoff coverage; `verify:release` requires both QEMU and Lean and must not silently skip either proof gate.
