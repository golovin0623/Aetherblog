export function resolveAiServiceErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object') {
    const maybe = error as { errorMessage?: string; message?: string; detail?: string };
    return maybe.errorMessage || maybe.message || maybe.detail || fallback;
  }
  return fallback;
}
