import type { BackgroundId } from "../../shared/background-metadata";

export type BackgroundFailureStage =
  "import" | "startup" | "runtime" | "update" | "resize";
export type BackgroundFailureReason =
  | "module-load"
  | "unavailable"
  | "unsupported"
  | "compile"
  | "context-lost"
  | "render";
type BackgroundRetryStatus =
  "scheduled" | "deferred" | "retrying" | "stopped" | "recovered" | "cancelled";
/** Last failure only, tab-local. Never includes settings, image URLs or stacks. */
export interface BackgroundFailure {
  id: BackgroundId;
  stage: BackgroundFailureStage;
  reason: BackgroundFailureReason;
  message: string;
  time: number;
  retry: BackgroundRetryStatus;
}

export function backgroundFailureMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Renderer failed.";
  return (
    message
      .replace(
        /(?:data:|blob:|https?:\/\/|file:\/\/|chrome-extension:\/\/)[^\s"'<>]*/gi,
        "[resource]",
      )
      .replace(/[A-Za-z0-9+/=]{80,}/g, "[data]")
      .replace(/\s+/g, " ")
      .slice(0, 240) || "Renderer failed."
  );
}

export function backgroundFailureReason(
  stage: BackgroundFailureStage,
  message: string,
): BackgroundFailureReason {
  if (stage === "import") return "module-load";
  if (/context.*lost|lost.*context/i.test(message)) return "context-lost";
  if (
    /not supported|unsupported|webgl.*(?:unavailable|not available)|(?:creating|create).*webgl.*context/i.test(
      message,
    )
  )
    return "unsupported";
  if (
    /compile|compilation|link.*(?:program|shader)|shader.*(?:error|invalid)/i.test(
      message,
    )
  )
    return "compile";
  return "render";
}

export function backgroundFailureStatus(failure: BackgroundFailure): string {
  const action =
    failure.retry === "scheduled"
      ? "Retrying shortly."
      : failure.retry === "deferred"
        ? "Retry when visible."
        : failure.retry === "retrying"
          ? "Retrying…"
          : failure.reason === "module-load"
            ? "Retry or reload this tab."
            : "Retry.";
  return `Background ${failure.stage}: ${failure.message} ${action}`;
}
