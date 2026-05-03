import { resolve } from "node:path";
import type {
  ApplyResult,
  CacheResult,
  CoreResult,
  DoctorResult,
  ExportResult,
  GraphResult,
  ImpactResult,
  InitResult,
  JsonObject,
  OverviewResult,
  ReadDocumentResult,
  RequirementIdPreviewResult,
  RequirementListResult,
  RequirementResult,
  SearchResultSet,
  TraceResult,
  ValidateResult
} from "./dto.js";
import type {
  ApplyChangeInput,
  CacheCleanInput,
  CacheMode,
  CacheRebuildInput,
  DoctorInput,
  ExportMarkdownInput,
  GenerateRequirementIdInput,
  GraphInput,
  GetRequirementInput,
  ImpactInput,
  InitInput,
  ListDocumentsInput,
  ListRequirementsInput,
  OverviewInput,
  ProposeChangeInput,
  ReadDocumentInput,
  SearchInput,
  TraceRequirementInput,
  ValidateInput
} from "./inputs.js";
import { applyChange } from "./apply-change.js";
import { cleanCache, rebuildCache } from "./cache.js";
import { listDocuments, readDocument } from "./documents.js";
import { doctor } from "./doctor.js";
import { exportMarkdown } from "./export-markdown.js";
import { initWorkspace } from "./init.js";
import { overview } from "./overview.js";
import { createProposal } from "./propose-change.js";
import {
  getRequirement,
  getRequirementFromReadModel,
  listRequirementsFromReadModel,
  loadRequirementRegistry,
  previewRequirementId,
  type RequirementRegistry
} from "./requirements.js";
import type { fail } from "./result.js";
import { loadReadModel } from "./read-model.js";
import { searchWorkspace } from "./search.js";
import { validateWorkspace } from "./validate.js";
import { impactRequirement } from "../graph/impact.js";
import { traceRequirement } from "../graph/trace.js";

type BindableInput = {
  cacheMode?: CacheMode | undefined;
};

type RootBound<T extends BindableInput> = Omit<T, "root"> & {
  root: string;
  cacheMode: CacheMode;
};

export type SpecKiwiCore = {
  root: string;
  cacheMode: CacheMode;
  init(input?: InitInput): Promise<InitResult>;
  doctor(input?: DoctorInput): Promise<DoctorResult>;
  cacheRebuild(input?: CacheRebuildInput): Promise<CacheResult>;
  cacheClean(input?: CacheCleanInput): Promise<CacheResult>;
  exportMarkdown(input?: ExportMarkdownInput): Promise<ExportResult>;
  overview(input?: OverviewInput): Promise<OverviewResult>;
  listDocuments(input?: ListDocumentsInput): ReturnType<typeof listDocuments>;
  readDocument(input: ReadDocumentInput): Promise<ReadDocumentResult>;
  search(input: SearchInput): Promise<SearchResultSet>;
  getRequirement(input: GetRequirementInput): Promise<RequirementResult>;
  listRequirements(input?: ListRequirementsInput): Promise<RequirementListResult>;
  previewRequirementId(input: GenerateRequirementIdInput): Promise<RequirementIdPreviewResult>;
  traceRequirement(input: TraceRequirementInput): Promise<TraceResult>;
  graph(input?: GraphInput): Promise<GraphResult>;
  impact(input: ImpactInput): Promise<ImpactResult>;
  validate(input?: ValidateInput): Promise<ValidateResult>;
  proposeChange(input: ProposeChangeInput): ReturnType<typeof createProposal>;
  applyChange(input: ApplyChangeInput): Promise<ApplyResult>;
  loadRequirementRegistry(): Promise<RequirementRegistry>;
};

export type McpToolResultCore =
  | OverviewResult
  | ReturnType<typeof fail>
  | ReadDocumentResult
  | SearchResultSet
  | RequirementResult
  | RequirementListResult
  | RequirementIdPreviewResult
  | GraphResult
  | TraceResult
  | ImpactResult
  | ValidateResult
  | ApplyResult
  | CacheResult
  | DoctorResult
  | InitResult
  | ExportResult
  | CoreResult<JsonObject>;

export function createSpecKiwiCore(input: { root: string; cacheMode?: CacheMode }): SpecKiwiCore {
  const root = resolve(input.root);
  const cacheMode = input.cacheMode ?? "auto";

  function bind<T extends BindableInput>(value: T | undefined): RootBound<T> {
    return {
      ...stripUndefined(value ?? ({} as T)),
      root,
      cacheMode: value?.cacheMode ?? cacheMode
    } as RootBound<T>;
  }

  async function graph(inputValue: GraphInput = {}): Promise<GraphResult> {
    const model = await loadReadModel({
      root,
      cacheMode: inputValue.cacheMode ?? cacheMode,
      sections: ["graph"]
    });
    return model.buildGraph(inputValue.graphType);
  }

  async function search(inputValue: SearchInput): Promise<SearchResultSet> {
    return searchWorkspace(bind(inputValue) as SearchInput);
  }

  async function listRequirementsWithModel(inputValue: ListRequirementsInput = {}): Promise<RequirementListResult> {
    const model = await loadReadModel({
      root,
      cacheMode: inputValue.cacheMode ?? cacheMode,
      sections: ["entities", "relations"]
    });
    return listRequirementsFromReadModel(bind(inputValue) as ListRequirementsInput, model);
  }

  return {
    root,
    cacheMode,
    init: (value = {}) => initWorkspace(bind(value) as InitInput),
    doctor: (value = {}) => doctor(bind(value) as DoctorInput),
    cacheRebuild: (value = {}) => rebuildCache(bind(value) as CacheRebuildInput),
    cacheClean: (value = {}) => cleanCache(bind(value) as CacheCleanInput),
    exportMarkdown: (value = {}) => exportMarkdown(bind(value) as ExportMarkdownInput),
    overview: (value = {}) => overview(bind(value) as OverviewInput),
    listDocuments: (value = {}) => listDocuments(bind(value) as ListDocumentsInput),
    readDocument: (value) => readDocument(bind(value) as ReadDocumentInput),
    search,
    getRequirement: async (value) => {
      const bound = bind(value) as GetRequirementInput;
      if (bound.cacheMode === "bypass") {
        const model = await loadReadModel({
          root,
          cacheMode: bound.cacheMode,
          sections: ["entities", "relations"]
        });
        return getRequirementFromReadModel(bound, model);
      }
      return getRequirement(bound);
    },
    listRequirements: listRequirementsWithModel,
    previewRequirementId: async (value) =>
      previewRequirementId(bind(value) as GenerateRequirementIdInput, await loadRequirementRegistry({ root, cacheMode: value.cacheMode ?? cacheMode })),
    traceRequirement: async (value) =>
      traceRequirement(bind(value) as TraceRequirementInput, await graph({ graphType: "traceability", cacheMode: value.cacheMode ?? cacheMode })),
    graph,
    impact: async (value) =>
      impactRequirement(bind(value) as ImpactInput, await graph({ graphType: "traceability", cacheMode: value.cacheMode ?? cacheMode })),
    validate: (value = {}) => validateWorkspace(bind(value) as ValidateInput),
    proposeChange: (value) => createProposal(bind(value) as ProposeChangeInput),
    applyChange: (value) => applyChange(bind(value) as ApplyChangeInput),
    loadRequirementRegistry: async () => {
      const model = await loadReadModel({ root, cacheMode, sections: ["entities", "relations"] });
      return model.getRequirementRegistry();
    }
  };
}

function stripUndefined<T extends BindableInput>(value: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key as keyof T] = entry as T[keyof T];
    }
  }
  return output;
}
