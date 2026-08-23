/**
 * Shared validator for `timeoutMs`-style options (`LlmCognitionOptions`,
 * `LlmCriticOptions`): the Anthropic SDK rejects negative, non-integer,
 * `NaN` and infinite timeouts, and a `0` timeout aborts every request
 * immediately — none of which should silently reach the SDK from a
 * caller's typo or miscalculation.
 */
export function isValidTimeoutMs(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
