// express.json passes limit to lenient bytes.parse, so the raw env value must never be passed through.
// express.json은 limit을 관대한 bytes.parse에 전달하므로, 원시 env 값을 그대로 전달하면 안 됩니다.

export const JSON_BODY_LIMIT_ENV = "MCP_JSON_BODY_LIMIT";
export const DEFAULT_JSON_BODY_LIMIT = "1mb";
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 1048576;

export function parseJsonBodyLimit(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const multipliers: Record<string, number> = {
    "": 1,
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  const result = Math.floor(amount * multipliers[unit]);

  if (!Number.isFinite(result) || !Number.isSafeInteger(result) || result <= 0) {
    return null;
  }

  return result;
}

export function resolveJsonBodyLimit(
  raw: string | undefined = process.env[JSON_BODY_LIMIT_ENV],
): number {
  if (raw === undefined) {
    return DEFAULT_JSON_BODY_LIMIT_BYTES;
  }

  const parsed = parseJsonBodyLimit(raw);
  if (parsed === null) {
    console.warn(
      "⚠️ MCP_JSON_BODY_LIMIT is invalid; using the default 1mb / MCP_JSON_BODY_LIMIT 값이 유효하지 않아 기본값 1mb를 사용합니다.",
    );
    return DEFAULT_JSON_BODY_LIMIT_BYTES;
  }

  return parsed;
}
