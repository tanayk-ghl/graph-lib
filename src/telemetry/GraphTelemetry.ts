import type {
  OperationFailureEvent,
  OperationStartEvent,
  OperationSuccessEvent,
} from "../types.js";

/** Lifecycle hooks for observing graph API operations. */
export interface GraphTelemetry {
  onOperationStart(event: OperationStartEvent): void;
  onOperationSuccess(event: OperationSuccessEvent): void;
  onOperationFailure(event: OperationFailureEvent): void;
}

/** Default telemetry implementation when callers do not provide one. */
export class NoopGraphTelemetry implements GraphTelemetry {
  onOperationStart(_event: OperationStartEvent): void {}

  onOperationSuccess(_event: OperationSuccessEvent): void {}

  onOperationFailure(_event: OperationFailureEvent): void {}
}
