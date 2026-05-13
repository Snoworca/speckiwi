export const REPORT_PATHS_COLUMN = "Report Paths";
export const REPORT_PATH_TOKEN_PATTERN =
  String.raw`^(?=.*\S)(?!/)(?!\.\/)(?!\.\.\/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|/)\.\.(?:/|$))(?!.*[\\|,\r\n#]).+$`;
export const REPORT_PATH_TOKEN_REGEX = new RegExp(REPORT_PATH_TOKEN_PATTERN);

export interface ReportPathIssue {
  token: string;
  reason: string;
}

export interface ParsedReportPaths {
  paths: string[];
  issues: ReportPathIssue[];
}

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function validateReportPathToken(token: string): ReportPathIssue | undefined {
  const value = token.trim();
  if (!value) return { token, reason: "empty report path" };
  if (value.startsWith("/")) return { token: value, reason: "absolute paths are not allowed" };
  if (value.startsWith("./")) return { token: value, reason: "paths must not start with ./" };
  if (value.startsWith("../")) return { token: value, reason: "paths must not start with ../" };
  if (URL_SCHEME.test(value)) return { token: value, reason: "URL schemes are not allowed" };
  if (value.includes("..")) {
    const segments = value.split("/");
    if (segments.includes("..")) return { token: value, reason: "parent traversal segments are not allowed" };
  }
  if (value.includes("\\")) return { token: value, reason: "backslashes are not allowed" };
  if (value.includes("|")) return { token: value, reason: "Markdown table delimiters are not allowed" };
  if (value.includes(",")) return { token: value, reason: "commas are not allowed" };
  if (/[\r\n]/.test(value)) return { token: value, reason: "newlines are not allowed" };
  if (value.includes("#")) return { token: value, reason: "fragment markers are not allowed" };
  return undefined;
}

export function parseReportPathCell(cell: string): ParsedReportPaths {
  const trimmed = cell.trim();
  if (!trimmed) return { paths: [], issues: [] };

  const paths: string[] = [];
  const issues: ReportPathIssue[] = [];
  for (const rawToken of cell.split(",")) {
    const token = rawToken.trim();
    const issue = validateReportPathToken(token);
    if (issue) {
      issues.push(issue);
      if (!token) continue;
    }
    paths.push(token);
  }
  return { paths, issues };
}

export function normalizeReportPathsInput(value: readonly string[] | null | undefined): ParsedReportPaths {
  const paths: string[] = [];
  const issues: ReportPathIssue[] = [];
  for (const rawToken of value ?? []) {
    const token = rawToken.trim();
    const issue = validateReportPathToken(token);
    if (issue) issues.push(issue);
    if (token) paths.push(token);
  }
  return { paths, issues };
}
