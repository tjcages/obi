import { Context, Effect } from "effect";
import type {
  GmailScriptArgs,
  ScriptExecutionError,
  ScriptTimeoutError,
  GmailApiError,
} from "../domain";

export interface ScriptExecutorService {
  readonly execute: (
    args: GmailScriptArgs
  ) => Effect.Effect<
    unknown,
    ScriptExecutionError | ScriptTimeoutError | GmailApiError
  >;
}

export const ScriptExecutor = Context.GenericTag<ScriptExecutorService>(
  "@inbox/ScriptExecutor"
);
