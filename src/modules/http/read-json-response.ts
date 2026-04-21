type ReadJsonResponseOptions = {
  context: string;
  htmlHint?: string;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractHtmlTitle(body: string) {
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!titleMatch) {
    return null;
  }

  const title = normalizeWhitespace(titleMatch[1] ?? "");
  return title || null;
}

function looksLikeHtml(body: string, contentType: string) {
  const normalized = body.trimStart().toLowerCase();

  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml") ||
    normalized.startsWith("<!doctype html") ||
    normalized.startsWith("<html") ||
    normalized.startsWith("<?xml") ||
    normalized.startsWith("<head") ||
    normalized.startsWith("<body")
  );
}

export async function readJsonResponse<T>(
  response: Response,
  options: ReadJsonResponseOptions,
): Promise<T> {
  const body = await response.text();
  const normalizedBody = body.trim();

  if (!normalizedBody) {
    throw new Error(`${options.context} returned an empty response instead of JSON.`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (looksLikeHtml(body, contentType)) {
      const title = extractHtmlTitle(body);
      const titleSuffix = title ? ` (${title})` : "";
      const hintSuffix = options.htmlHint ? ` ${options.htmlHint}` : "";

      throw new Error(
        `${options.context} returned HTML instead of JSON${titleSuffix}.${hintSuffix}`,
      );
    }

    throw new Error(`${options.context} returned invalid JSON.`);
  }
}
