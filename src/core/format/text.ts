export interface CoreDisplayModel {
  title?: string;
  rows?: Array<Record<string, unknown>>;
  text?: string;
}

function suppressEmptyReportPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => suppressEmptyReportPaths(item));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "reportPaths" && Array.isArray(nested) && nested.length === 0) continue;
    result[key] = suppressEmptyReportPaths(nested);
  }
  return result;
}

export function formatHumanOutput(value: CoreDisplayModel | unknown): string {
  if (typeof value === "string") return value;
  const model = value as CoreDisplayModel;
  if (model.text) return model.text;
  if (model.rows) {
    return model.rows.map((row) => Object.values(row).join("\t")).join("\n");
  }
  return JSON.stringify(suppressEmptyReportPaths(value), null, 2);
}
