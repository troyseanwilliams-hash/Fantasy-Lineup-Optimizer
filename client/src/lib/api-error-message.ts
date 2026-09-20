/** Extract the server's explanation from apiRequest's status-prefixed errors. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message.trim()) return fallback;
  const body = message.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message;
  } catch {
    // Network errors and plain-text responses are already readable.
  }
  return body || fallback;
}