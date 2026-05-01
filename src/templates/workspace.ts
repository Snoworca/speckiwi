import type { InitInput } from "../core/inputs.js";

export const WORKSPACE_DIRECTORIES = ["prd", "srs", "tech", "adr", "rules", "proposals", "templates", "cache", "exports"] as const;

export type WorkspaceTemplateFile = {
  path: string;
  content: string;
};

export type WorkspaceTemplate = {
  directories: readonly string[];
  files: WorkspaceTemplateFile[];
};

export function createWorkspaceTemplate(input: Pick<InitInput, "projectId" | "projectName" | "language"> = {}): WorkspaceTemplate {
  const projectId = input.projectId ?? "speckiwi";
  const projectName = input.projectName ?? "SpecKiwi";
  const language = input.language ?? "ko";

  return {
    directories: WORKSPACE_DIRECTORIES,
    files: [
      {
        path: "index.yaml",
        content: renderIndexTemplate(projectId, projectName, language)
      },
      {
        path: "overview.yaml",
        content: renderOverviewTemplate(projectName)
      },
      {
        path: "dictionary.yaml",
        content: renderDictionaryTemplate()
      }
    ]
  };
}

function renderIndexTemplate(projectId: string, projectName: string, language: string): string {
  return `schemaVersion: speckiwi/index/v1

project:
  id: ${quoteYamlString(projectId)}
  name: ${quoteYamlString(projectName)}
  language: ${quoteYamlString(language)}

settings:
  agent:
    defaultWriteMode: propose
    allowApply: true
  search:
    defaultMode: auto
    koreanNgram:
      min: 2
      max: 3

documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: dictionary
    type: dictionary
    path: dictionary.yaml

scopes: []
links: []
`;
}

function renderOverviewTemplate(projectName: string): string {
  return `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: ${quoteYamlString(projectName)}
status: draft
summary: ""
goals: []
nonGoals: []
glossary: []
`;
}

function renderDictionaryTemplate(): string {
  return `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Search Dictionary
status: draft
synonyms: {}
normalizations: {}
`;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}
