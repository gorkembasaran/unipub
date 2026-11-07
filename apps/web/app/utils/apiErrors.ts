export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const rawMessage = error.message.trim();
  const jsonStart = rawMessage.indexOf("{");

  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        message?: string | string[];
      };

      if (Array.isArray(parsed.message) && parsed.message.length > 0) {
        return parsed.message.join(" ");
      }

      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      return normalizeApiMessage(rawMessage, fallback);
    }
  }

  return normalizeApiMessage(rawMessage, fallback);
}

function normalizeApiMessage(rawMessage: string, fallback: string) {
  const normalized = rawMessage.replace(/^API error \d+:\s*/i, "").trim();

  if (!normalized) {
    return fallback;
  }

  if (/internal server error/i.test(normalized)) {
    return fallback;
  }

  if (/^cannot\s+(get|post|put|patch|delete)\b/i.test(normalized)) {
    return fallback;
  }

  return normalized;
}
