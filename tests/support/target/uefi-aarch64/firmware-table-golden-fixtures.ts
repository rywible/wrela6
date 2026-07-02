export const UEFI_TABLE_FIELD_GOLDEN = Object.freeze({
  systemTable: Object.freeze({
    conOut: Object.freeze({
      tableKey: "system-table",
      fieldKey: "con-out",
      offsetBytes: 64,
      valueKind: "pointer",
      requiredBeforeExitBootServices: false,
    }),
    bootServices: Object.freeze({
      tableKey: "system-table",
      fieldKey: "boot-services",
      offsetBytes: 96,
      valueKind: "pointer",
      requiredBeforeExitBootServices: true,
    }),
  }),
  bootServices: Object.freeze({
    getMemoryMap: Object.freeze({
      tableKey: "boot-services",
      fieldKey: "get-memory-map",
      offsetBytes: 56,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
    exitBootServices: Object.freeze({
      tableKey: "boot-services",
      fieldKey: "exit-boot-services",
      offsetBytes: 232,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
    setWatchdogTimer: Object.freeze({
      tableKey: "boot-services",
      fieldKey: "set-watchdog-timer",
      offsetBytes: 256,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    }),
  }),
});
