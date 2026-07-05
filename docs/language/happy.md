```wr
use write_smoke_marker from wrela_std.target.uefi.console
use UefiStatus from wrela_std.target.uefi.status

uefi image HappySmokeImage:
    fn boot() -> UefiStatus:
        write_smoke_marker()
```

## Language Rulings

The fenced program above is the executable happy-path smoke program used by the
CLI and parser audits. The broader language rules validated by the remediation
plan are kept here as reference prose:

- String literals preserve their raw spelling for reconstruction and expose a
  cooked value side channel. Valid escapes are `\\`, `\"`, `\n`, `\r`, `\t`,
  `\0`, `\xNN` with exactly two hex digits, and `\u{H+}` with one to six hex
  digits no larger than `0x10FFFF` and not in the surrogate range.
- `pub` is not a language keyword. Top-level `pub fn ...` is rejected as an
  invalid declaration head, and public/private visibility is not part of this
  source language in the current plan.
- Block locals and pattern bindings shadow outer values consistently. Builtin
  type names and imported type names remain protected by their own name-space
  diagnostics.
- wrela does not allow recursive functions; use loops or streams instead.
  By-value source types are also non-recursive. Bounded recursion is out of this plan.
- Bitwise operators use Rust-style precedence: shifts bind above `+`; `&`, `^`,
  and `|` bind above comparisons, in that order. Bitwise operations are defined
  for same-width unsigned integer operands.
- Signed integers are deferred to a future RFC because the current proof
  arithmetic assumes unsigned, checked semantics.
