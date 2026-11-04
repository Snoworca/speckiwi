import { pageSlice, type PageInfo } from "../query/discovery.js";
import { fail, ok, type Result } from "../result.js";
import type { PrdDocument, PrdItem } from "./model.js";

// @req FR-NODE-240 AC-3 — items in document order, paged with the requirement list's page fields.

export interface PrdPageOptions {
  offset?: number;
  limit?: number;
}

export type PrdPage = PageInfo;

/** One PRD item as the item list, the item read and search return it. */
export interface PrdItemView {
  id: string;
  title: string;
  kind: string;
  state: string;
  quote: string;
  source: string[];
  body: string;
  exclusionClass?: string;
  reason?: string;
  effect?: string;
  line: number;
  /** `<path>@sha256:<hex>` of the PRD the item was read from. */
  prd: string;
}

export function prdItemView(doc: PrdDocument, item: PrdItem): PrdItemView {
  const view: PrdItemView = {
    id: item.id,
    title: item.title,
    kind: item.kind,
    state: item.state,
    quote: item.quote,
    source: item.source,
    body: item.body,
    line: item.line,
    prd: doc.pointer
  };
  if (item.exclusionClass !== undefined) view.exclusionClass = item.exclusionClass;
  if (item.reason !== undefined) view.reason = item.reason;
  if (item.effect !== undefined) view.effect = item.effect;
  return view;
}

export function listPrdItems(doc: PrdDocument, options: PrdPageOptions = {}): { items: PrdItemView[]; page: PrdPage } {
  return pageSlice(doc.items.map((item) => prdItemView(doc, item)), options);
}

export function readPrdItem(doc: PrdDocument, itemId: string): Result<PrdItemView> {
  const item = doc.items.find((candidate) => candidate.id === itemId);
  return item ? ok(prdItemView(doc, item)) : fail("PRD_ITEM_NOT_FOUND", `${doc.path} holds no item ${itemId}`);
}
