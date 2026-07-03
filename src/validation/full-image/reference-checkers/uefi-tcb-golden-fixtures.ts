export const FULL_IMAGE_UEFI_TCB_GOLDEN = Object.freeze({
  targetKey: "wrela-uefi-aarch64-rpi5-v1",
  status: Object.freeze({
    success: Object.freeze({ description: "EFI_SUCCESS", value: 0n }),
    invalidParameter: Object.freeze({
      description: "EFI_INVALID_PARAMETER",
      value: 0x8000000000000002n,
    }),
    badBufferSize: Object.freeze({
      description: "EFI_BAD_BUFFER_SIZE",
      value: 0x8000000000000004n,
    }),
    bufferTooSmall: Object.freeze({
      description: "EFI_BUFFER_TOO_SMALL",
      value: 0x8000000000000005n,
    }),
    unsupported: Object.freeze({
      description: "EFI_UNSUPPORTED",
      value: 0x8000000000000003n,
    }),
    aborted: Object.freeze({ description: "EFI_ABORTED", value: 0x8000000000000015n }),
    panicStatus: "aborted",
  }),
  firmwareTables: Object.freeze({
    "system-table:con-out": Object.freeze({
      offsetBytes: 64,
      valueKind: "pointer",
      requiredBeforeExitBootServices: false,
    }),
    "system-table:boot-services": Object.freeze({
      offsetBytes: 96,
      valueKind: "pointer",
      requiredBeforeExitBootServices: true,
    }),
    "simple-text-output:output-string": Object.freeze({
      offsetBytes: 8,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: false,
    }),
    "boot-services:set-watchdog-timer": Object.freeze({
      offsetBytes: 256,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
    "boot-services:get-memory-map": Object.freeze({
      offsetBytes: 56,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
    "boot-services:allocate-pool": Object.freeze({
      offsetBytes: 64,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
    "boot-services:exit-boot-services": Object.freeze({
      offsetBytes: 232,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
  }),
  platformNames: Object.freeze({
    output_string: "uefi.console.outputString",
    set_watchdog_timer: "uefi.boot.setWatchdogTimer",
    exit_boot_services_with_fresh_map: "uefi.boot.exitBootServices",
    validation_fixture_packet_source: "uefi.validation.fixturePacketSource",
  }),
  runtimeHelpers: Object.freeze({
    "1000": Object.freeze({
      linkageName: "__wrela_uefi_status_from_boot_result",
      convention: "wrela-private",
      materialization: "backend-object",
    }),
    "1002": Object.freeze({
      linkageName: "__wrela_uefi_entry_initialize_context",
      convention: "wrela-private",
      materialization: "backend-object",
    }),
    "1006": Object.freeze({
      linkageName: "__wrela_uefi_exit_boot_services_with_fresh_map",
      convention: "wrela-private",
      materialization: "backend-object",
    }),
  }),
  entryProfile: Object.freeze({
    peEntryLinkageName: "__wrela_uefi_entry",
    imageEntryShimSymbol: "wrela.image.entry_shim",
    bootFunctionSymbol: "wrela.image.boot",
    imageHandleSourceKey: "uefi.imageHandle",
    systemTableSourceKey: "uefi.systemTable",
    entryCallConvention: "uefi-aapcs64",
    bootCallConvention: "wrela-source",
    statusResultRegister: "x0",
    thunkStrategy: "framed-call",
  }),
});
