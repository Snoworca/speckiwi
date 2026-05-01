export function tokenizeKorean(input: string): string[] {
  const chunks = input.normalize("NFKC").match(/[\uac00-\ud7a3]+/g) ?? [];
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    addChunkTokens(chunk, tokens, seen);
  }

  if (chunks.length > 1) {
    addChunkTokens(chunks.join(""), tokens, seen);
  }

  return tokens;
}

function addChunkTokens(chunk: string, tokens: string[], seen: Set<string>): void {
  if (chunk.length < 2) {
    return;
  }

  addToken(chunk, tokens, seen);
  for (const size of [2, 3]) {
    if (chunk.length < size) {
      continue;
    }
    for (let index = 0; index <= chunk.length - size; index += 1) {
      addToken(chunk.slice(index, index + size), tokens, seen);
    }
  }
}

function addToken(token: string, tokens: string[], seen: Set<string>): void {
  if (!seen.has(token)) {
    seen.add(token);
    tokens.push(token);
  }
}
