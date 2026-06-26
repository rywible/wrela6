export {
  MONO_EXPRESSION_CLONE_COVERAGE,
  MONO_STATEMENT_CLONE_COVERAGE,
} from "./function-clone-coverage";
export {
  instantiateMonoFunctionBody,
  type InstantiateMonoFunctionBodyInput,
  type InstantiateMonoFunctionBodyResult,
  type MonoOutgoingEdge,
} from "./function-instantiator-body";
export {
  instantiateMonoFunctionShell,
  type InstantiateMonoFunctionShellInput,
  type InstantiateMonoFunctionShellResult,
  type MonoFunctionRemap,
} from "./function-instantiator-shell";
