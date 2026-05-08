export function detectNewline(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}
