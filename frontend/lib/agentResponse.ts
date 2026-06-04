function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractQuotedContent(text: string): string | null {
  const m = text.match(/"content"\s*:\s*"/);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const meta = text.slice(start).match(/"\s*,\s*"metadata"\s*:/);
  if (meta?.index !== undefined) {
    return unescapeJsonString(text.slice(start, start + meta.index));
  }
  return null;
}

/** 从 Agent JSON / Markdown 代码块中取出给用户看的 content */
export function unwrapAgentContent(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) {
    text = fence[1].trim();
  }
  const brace = text.indexOf("{");
  if (brace > 0) {
    text = text.slice(brace);
  }

  if (text.startsWith("{") && text.includes('"content"')) {
    try {
      const data = JSON.parse(text) as { content?: unknown };
      if (typeof data.content === "string") {
        return data.content;
      }
    } catch {
      const extracted = extractQuotedContent(text);
      if (extracted) return extracted;
    }
  }

  if (raw.includes('"content"')) {
    const extracted = extractQuotedContent(raw);
    if (extracted) return extracted;
  }

  return raw;
}
