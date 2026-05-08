export interface CoreDisplayModel {
  title?: string;
  rows?: Array<Record<string, unknown>>;
  text?: string;
}

export function formatHumanOutput(value: CoreDisplayModel | unknown): string {
  if (typeof value === "string") return value;
  const model = value as CoreDisplayModel;
  if (model.text) return model.text;
  if (model.rows) {
    return model.rows.map((row) => Object.values(row).join("\t")).join("\n");
  }
  return JSON.stringify(value, null, 2);
}
