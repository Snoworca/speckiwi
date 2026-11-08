// @req FR-NODE-239 — tokenizer shared by the search index and the query, so both sides always
// produce the same terms. Research 42 §4: in-word Hangul bigrams matched morphological analysers
// on this corpus with no dependency, and are the only dependency-free way to absorb spacing
// differences ("저장소루트" ↔ "저장소 루트").

export type QueryWordScript = "hangul" | "other";

/** One query word: the unit the coverage rule counts, with the index terms it produces. */
export interface QueryWord {
  text: string;
  script: QueryWordScript;
  /** Every distinct term of the word; all of them add to the score. */
  terms: string[];
  /**
   * What a record must hold to match the word: every part needs one of its terms. A Latin word is
   * read in lower case and has one part per term (`FR-NODE-999` → fr · node · 999, `check_vibe_gate`
   * → the whole name and each piece, `rankRequirements` → the whole name), so it matches only a
   * record holding all of them, and its capitalisation never changes the result. A Hangul word is
   * one part: any of its bigrams will do.
   */
  parts: string[][];
}

export type TermVisitor = (term: string, start: number) => void;

/**
 * The words of one corpus, used to fold a plural onto the singular that corpus writes. Spelling
 * alone cannot tell "aliases" (alias + es) from "erases" (erase + s), nor "lenses" from "lens" +
 * es; the corpus can, so the index and every query against it fold through the same vocabulary.
 */
export interface SearchVocabulary {
  /** The corpus spelling that stands for the singular-plural family of a lower-case word. */
  canonical(word: string): string;
}

/**
 * A memo that forgets everything once it holds `limit` entries. Words repeat, so a hit rate stays
 * high; the bound only stops a long-lived server (a cached index answering endless distinct query
 * words) from growing without limit. Every cache in this module goes through it.
 */
export class BoundedMemo<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K, compute: (key: K) => V): V {
    const known = this.entries.get(key);
    if (known !== undefined) return known;
    if (this.entries.size >= this.limit) this.entries.clear();
    const value = compute(key);
    this.entries.set(key, value);
    return value;
  }
}

/** The bound on every memo here: far above one corpus's vocabulary of a few thousand words. */
const STEM_CACHE_LIMIT = 50_000;

const LETTERS_ONLY = /^[a-z]+$/;

class CorpusVocabulary implements SearchVocabulary {
  private readonly folded = new BoundedMemo<string, string>(STEM_CACHE_LIMIT);

  constructor(private readonly words: ReadonlySet<string>) {}

  canonical(word: string): string {
    if (word.length < 3 || !LETTERS_ONLY.test(word)) return word;
    return this.folded.get(word, (key) => this.fold(key));
  }

  private fold(word: string): string {
    if (this.words.has(word)) return this.singular(word);
    // A word the corpus never writes: first its own singular there ("eras" → "era"), then the
    // corpus plural it is the singular of ("lens" → "lenses", "erase" → "erases").
    const singular = this.singular(word);
    if (singular !== word) return singular;
    for (const plural of [`${word}s`, `${word}es`]) if (this.words.has(plural)) return this.singular(plural);
    return word;
  }

  /** Follows w → w - s, else w - es, while the shorter spelling is a word of this corpus. */
  private singular(word: string): string {
    const candidates = word.endsWith("es") ? [word.slice(0, -1), word.slice(0, -2)] : word.endsWith("s") && !word.endsWith("ss") ? [word.slice(0, -1)] : [];
    const found = candidates.find((candidate) => candidate.length >= 2 && this.words.has(candidate));
    return found === undefined ? word : this.singular(found);
  }
}

/** No corpus: every word stands for itself, and plain Porter decides. */
export const EMPTY_VOCABULARY: SearchVocabulary = new CorpusVocabulary(new Set());

/**
 * The vocabulary of the given texts: every word the tokenizer asks to fold while it reads them —
 * whole words, camelCase and snake_case pieces, digit-led letter tails — so the vocabulary holds
 * exactly the spellings that term-making later folds.
 */
export function buildSearchVocabulary(texts: Iterable<string>): SearchVocabulary {
  const words = new Set<string>();
  const recorder: SearchVocabulary = {
    canonical(word) {
      words.add(word);
      return word;
    }
  };
  for (const text of texts) scanTerms(text, () => undefined, recorder);
  return new CorpusVocabulary(words);
}

const STOPWORDS = new Set(
  "a an the of to in on for and or is are be by with from as at that this it its into when shall must not no only than then which who whose each every one".split(" ")
);

const QUERY_WORD = /[A-Za-z0-9_](?:[A-Za-z0-9_\-./]*[A-Za-z0-9_])?|[가-힣]+/g;
const HANGUL = /[가-힣]/;
const UNDERSCORE = 95;

// Character-code scanning instead of regular expressions: the index tokenizes every record on
// each CLI call, and this loop is what keeps the index build inside its time budget.
function isLatinCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === UNDERSCORE;
}

function isHangulCode(code: number): boolean {
  return code >= 0xac00 && code <= 0xd7a3;
}

function isLowerOrDigitCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function isUpperCode(code: number): boolean {
  return code >= 65 && code <= 90;
}

// Porter (1980) steps 1a, 1b, 1c and 5a: a standard light stemmer, so one word family meets on one
// stem (string/strings, gate/gated, complete/completed) instead of ad-hoc suffix rules.
// Every word gets exactly one term, so a word adds to a score and to a field length once.
function porterStem(word: string): string {
  if (word.length < 3) return word;
  // A corpus repeats a few thousand words across ~200k tokens; remembering stems keeps the index build fast.
  return STEMS.get(word, (key) => porterStep5a(porterStep1c(porterStep1b(porterStep1a(key)))));
}

const DIGITS_THEN_LETTERS = /^(.*\d)([a-z]{3,})$/;

/**
 * The one way letters become a term: fold them through the vocabulary, then stem. Every path that
 * makes a Latin term (whole word, snake_case and camelCase piece, digit-led tail, hyphenated ID
 * piece) reaches its letters through here, so singular and plural meet whatever the path.
 */
function foldLetters(letters: string, vocabulary: SearchVocabulary): string {
  return porterStem(vocabulary.canonical(letters));
}

/** Makes the term of one lower-case piece; a piece with digits folds only its letter tail ("v2records" → "v2record"). */
function stemPiece(piece: string, vocabulary: SearchVocabulary): string {
  const tail = DIGITS_THEN_LETTERS.exec(piece);
  if (tail) return `${tail[1]}${foldLetters(tail[2]!, vocabulary)}`;
  return /\d/.test(piece) ? piece : foldLetters(piece, vocabulary);
}

const STEMS = new BoundedMemo<string, string>(STEM_CACHE_LIMIT);

function isConsonant(word: string, index: number): boolean {
  const letter = word[index]!;
  if ("aeiou".includes(letter)) return false;
  if (letter === "y") return index === 0 || !isConsonant(word, index - 1);
  return true;
}

/** Porter's m: the number of vowel-consonant sequences in `word`. */
function measure(word: string): number {
  let count = 0;
  let previousVowel = false;
  for (let index = 0; index < word.length; index += 1) {
    const vowel = !isConsonant(word, index);
    if (previousVowel && !vowel) count += 1;
    previousVowel = vowel;
  }
  return count;
}

function hasVowel(word: string): boolean {
  for (let index = 0; index < word.length; index += 1) if (!isConsonant(word, index)) return true;
  return false;
}

function endsWithDoubleConsonant(word: string): boolean {
  const last = word.length - 1;
  return last > 0 && word[last] === word[last - 1] && isConsonant(word, last);
}

/** Consonant-vowel-consonant ending whose last letter is not w, x or y ("hop", not "show"). */
function endsCvc(word: string): boolean {
  const last = word.length - 1;
  return last >= 2 && isConsonant(word, last - 2) && !isConsonant(word, last - 1) && isConsonant(word, last) && !"wxy".includes(word[last]!);
}

function porterStep1a(word: string): string {
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function porterStep1b(word: string): string {
  if (word.endsWith("eed")) return measure(word.slice(0, -3)) > 0 ? word.slice(0, -1) : word;
  const suffix = word.endsWith("ed") ? 2 : word.endsWith("ing") ? 3 : 0;
  if (suffix === 0 || !hasVowel(word.slice(0, -suffix))) return word;
  const base = word.slice(0, -suffix);
  if (base.endsWith("at") || base.endsWith("bl") || base.endsWith("iz")) return `${base}e`;
  if (endsWithDoubleConsonant(base) && !"lsz".includes(base[base.length - 1]!)) return base.slice(0, -1);
  if (measure(base) === 1 && endsCvc(base)) return `${base}e`;
  return base;
}

function porterStep1c(word: string): string {
  return word.endsWith("y") && hasVowel(word.slice(0, -1)) ? `${word.slice(0, -1)}i` : word;
}

function porterStep5a(word: string): string {
  if (!word.endsWith("e")) return word;
  const base = word.slice(0, -1);
  const m = measure(base);
  return m > 1 || (m === 1 && !endsCvc(base)) ? base : word;
}

/** The camelCase pieces of a Latin run as [start, end) pairs; one piece when unsplit. */
function latinPieces(text: string, start: number, end: number): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  let pieceStart = start;
  for (let index = start + 1; index < end; index += 1) {
    if (isUpperCode(text.charCodeAt(index)) && isLowerOrDigitCode(text.charCodeAt(index - 1))) {
      pieces.push([pieceStart, index]);
      pieceStart = index;
    }
  }
  pieces.push([pieceStart, end]);
  return pieces;
}

/**
 * The terms a Latin run must match on, read from its lower-case spelling so letter case never
 * changes them: the whole run (its snake_case pieces stemmed and re-joined with "_"), then each
 * snake_case piece, each with the offset in the run where its characters begin (a Latin run is
 * ASCII, so the lower-case spelling keeps every offset).
 */
function caseFreeLatinTerms(lower: string, vocabulary: SearchVocabulary): LatinTerm[] {
  let cache = RUN_TERMS.get(vocabulary);
  if (!cache) {
    cache = new BoundedMemo(STEM_CACHE_LIMIT);
    RUN_TERMS.set(vocabulary, cache);
  }
  return cache.get(lower, (key) => computeCaseFreeLatinTerms(key, vocabulary));
}

// Terms depend on the vocabulary, so each vocabulary keeps its own run cache and drops it with itself.
const RUN_TERMS = new WeakMap<SearchVocabulary, BoundedMemo<string, LatinTerm[]>>();

interface LatinTerm {
  term: string;
  offset: number;
}

function computeCaseFreeLatinTerms(lower: string, vocabulary: SearchVocabulary): LatinTerm[] {
  const pieces: LatinTerm[] = [];
  let offset = 0;
  for (const piece of lower.split("_")) {
    if (piece.length > 0) pieces.push({ term: piece, offset });
    offset += piece.length + 1;
  }
  if (pieces.length === 0) return [];
  const stemmed = pieces.map((piece) => ({ ...piece, term: stemPiece(piece.term, vocabulary) }));
  if (pieces.length === 1) return STOPWORDS.has(pieces[0]!.term) ? [] : stemmed;
  const whole = { term: stemmed.map((piece) => piece.term).join("_"), offset: 0 };
  return [whole, ...stemmed.filter((_, position) => !STOPWORDS.has(pieces[position]!.term))];
}

/**
 * A Latin run yields its case-free terms, then its camelCase pieces as extra terms, so "code" still
 * finds "OpenCode" while "OpenCode" and "opencode" index the same required terms.
 */
function latinTerms(text: string, start: number, end: number, visit: TermVisitor, vocabulary: SearchVocabulary): void {
  for (const { term, offset } of caseFreeLatinTerms(text.slice(start, end).toLowerCase(), vocabulary)) visit(term, start + offset);
  const pieces = latinPieces(text, start, end);
  if (pieces.length < 2 || text.slice(start, end).includes("_")) return;
  for (const [pieceStart, pieceEnd] of pieces) {
    const piece = text.slice(pieceStart, pieceEnd).toLowerCase();
    if (!STOPWORDS.has(piece)) visit(stemPiece(piece, vocabulary), pieceStart);
  }
}

/**
 * A Hangul run yields its leading syllable, then its in-word bigrams. The leading syllable lets a
 * one-syllable noun meet the same noun with a particle attached ("키" ↔ "키를").
 */
function hangulTerms(text: string, start: number, end: number, visit: TermVisitor): void {
  visit(text[start]!, start);
  for (let index = start; index + 2 <= end; index += 1) visit(text.slice(index, index + 2), index);
}

/** Visits every index term of `text` with the offset where its source characters begin. */
export function scanTerms(text: string, visit: TermVisitor, vocabulary: SearchVocabulary = EMPTY_VOCABULARY): void {
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const latin = isLatinCode(code);
    if (!latin && !isHangulCode(code)) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length && (latin ? isLatinCode(text.charCodeAt(end)) : isHangulCode(text.charCodeAt(end)))) end += 1;
    if (latin) latinTerms(text, index, end, visit, vocabulary);
    else hangulTerms(text, index, end, visit);
    index = end;
  }
}

export function textTerms(text: string, vocabulary: SearchVocabulary = EMPTY_VOCABULARY): string[] {
  const terms: string[] = [];
  scanTerms(text, (term) => terms.push(term), vocabulary);
  return terms;
}

/**
 * A query part's terms. A Hangul part longer than one syllable leaves out its leading syllable:
 * that syllable is indexed so a one-syllable query noun ("키") meets "키를", but letting a longer
 * query word match on it alone ("저는" → "저장") lost KX R@10 0.893 → 0.619 in the 5.2.0 bench.
 */
function queryPartTerms(part: string): string[] {
  const terms = textTerms(part);
  return HANGUL.test(part) && part.length > 1 ? terms.slice(1) : terms;
}

/** One part per case-free term of each Latin run in the lower-cased word (runs split at - . /). */
function latinQueryParts(lower: string, vocabulary: SearchVocabulary): string[][] {
  return lower.split(/[^a-z0-9_]+/).flatMap((run) => caseFreeLatinTerms(run, vocabulary).map(({ term }) => [term]));
}

/**
 * Splits a query into the words the coverage rule counts: a Latin run (inner `-` `.` `/` kept,
 * so `completed-work` is one word) or a run of Hangul syllables. A word that yields no term
 * (a stopword) is dropped, so it never counts against coverage.
 */
export function splitQueryWords(query: string, vocabulary: SearchVocabulary = EMPTY_VOCABULARY): QueryWord[] {
  const words: QueryWord[] = [];
  const seen = new Set<string>();
  for (const match of query.matchAll(QUERY_WORD)) {
    const text = match[0];
    const hangul = HANGUL.test(text);
    const parts = hangul ? [[...new Set(queryPartTerms(text))]] : latinQueryParts(text.toLowerCase(), vocabulary);
    const terms = [...new Set(parts.flat())];
    if (terms.length === 0) continue;
    // Words that fold to the same terms ("lock Lock locks") are one word: they count once for
    // coverage and for the score. @req FR-NODE-262 AC-3 — so are words with the same parts in another
    // order (`completed-work work-completed`): the key is the parts as a sorted multiset.
    const key = JSON.stringify(parts.map((part) => JSON.stringify(part)).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    words.push({ text, script: hangul ? "hangul" : "other", terms, parts });
  }
  return words;
}
