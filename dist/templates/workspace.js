export const WORKSPACE_DIRECTORIES = ["prd", "srs", "tech", "adr", "rules", "proposals", "templates", "cache", "exports"];
export function createWorkspaceTemplate(input = {}) {
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
function renderIndexTemplate(projectId, projectName, language) {
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
function renderOverviewTemplate(projectName) {
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
function renderDictionaryTemplate() {
    return `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Search Dictionary
status: draft
synonyms: {}
normalizations: {}
`;
}
function quoteYamlString(value) {
    return JSON.stringify(value);
}
//# sourceMappingURL=workspace.js.map