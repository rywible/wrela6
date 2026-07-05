# Wrela Stdlib Compatibility Contract

This document defines the currently supported public source surface under
`stdlib/wrela-std`. Removing or renaming a documented module, public type, public
enum case, or public function is a breaking change unless a diagnostic migration
and compatibility plan are provided.

## Supported Modules

- `wrela_std.core.bits`
  - `Bits[Value]`
- `wrela_std.core.option`
  - `Option[Value]`
  - Cases: `some(value: Value)`, `none`
- `wrela_std.core.result`
  - `Result[Ok, Err]`
  - Cases: `ok(value: Ok)`, `err(error: Err)`
- `wrela_std.core.unit`
  - `Unit`
- `wrela_std.core.validation`
  - `Validation[Ok, Err, Source]`
- `wrela_std.target.uefi.console`
  - `output_string(message: Utf16Static) -> UefiStatus`
  - `write_console_string(message: Utf16Static) -> UefiStatus`
  - `write_smoke_marker() -> UefiStatus`
- `wrela_std.target.uefi.firmware`
  - `BootError`
  - `UefiDeviceName`
  - `UefiFirmware`
  - `UefiMemoryReserved`
  - `VirtioDiscovery`
  - `UefiVirtioBinder`
  - `VirtioDevices`
  - `VirtioDevice`
  - `NetworkBinding`
  - `MachinePlanner`
  - `MachineDeviceBindings`
  - `MachinePlan`
  - `Machine`
  - `MachineDevices`
  - `NetworkDevice`
  - `NetworkPaths`
  - `NetworkRxPath`
  - `NetworkTxPath`
- `wrela_std.target.uefi.memory`
  - `exit_boot_services_with_fresh_map() -> UefiStatus`
- `wrela_std.target.uefi.status`
  - `UefiStatus`
  - Cases: `success`, `load_error`, `invalid_parameter`, `unsupported`,
    `bad_buffer_size`, `buffer_too_small`, `device_error`, `not_found`,
    `aborted`, `security_violation`
- `wrela_std.target.uefi.watchdog`
  - `set_watchdog_timer(timeout_seconds: u64) -> UefiStatus`
  - `disable_watchdog() -> UefiStatus`

## Compatibility Policy

- The module names above are stable public imports.
- Public exported names above are stable within the current source-language
  surface.
- Strengthening a documented precondition is a breaking change unless the
  compiler also ships a stable diagnostic for the migration.
- Private platform functions in stdlib files remain implementation details even
  when they are present in source.
- `Option` and `Result` are tagged unions. Their case names and payload field
  names are part of the public source contract.
