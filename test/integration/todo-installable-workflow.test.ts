import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { listRequirements } from "../../src/core/query/lookup.js";
import { summarizeTarget } from "../../src/core/query/summary.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { createTestMcpServer, type McpServerHandle } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import type { ParsedWorkspace, RequirementRecord, ValidationResult } from "../../src/core/types.js";

const TODO_TARGET = "todo-installable-v1";
const PRODUCT_NAME = "설치형 Todo 리스트 관리 웹서비스";
const SERVER_SCOPE = "SRV";
const WEB_SCOPE = "WEB";

interface RequirementBlockInput {
  id: string;
  title: string;
  type: string;
  requirement: string;
  rationale: string;
  acceptanceCriteria: string[];
  traceLinks?: string[];
  implementationNotes: string;
  tags: string;
  risk?: string;
}

interface ScopeDocumentInput {
  heading: string;
  scope: string;
  scopeName: string;
  overview: string;
  inScope: string[];
  outOfScope: string[];
  assumptions: string[];
  requirements: RequirementBlockInput[];
  dependencies?: string[];
}

interface CliJsonResult {
  code: number;
  json: unknown;
  stdout: string;
  stderr: string;
}

type McpError = { message: string; code?: string };

function renderIndex(options: { omitScopeMap?: boolean } = {}): string {
  const scopeMap = options.omitScopeMap
    ? ""
    : [
        "## 4. Scope Map",
        "",
        "| Scope | Prefix | Primary Document | Notes |",
        "|---|---|---|---|",
        "| Server | SRV | [10.server.srs.md](./10.server.srs.md) | 설치형 Todo 서버 |",
        "| Web Page | WEB | [20.web-page.srs.md](./20.web-page.srs.md) | Todo 관리 웹 페이지 |",
        ""
      ].join("\n");

  return [
    `# ${PRODUCT_NAME} SRS Index`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    `| Product | ${PRODUCT_NAME} |`,
    "| Version | 1.0.0 |",
    "| Last Updated | 2026-05-08 |",
    "| Rules | [SRS-MD Authoring Rules v2.5.0](../rule/SRS-MD-Rules-v2.5.0.md) |",
    "",
    "## 1. Purpose",
    "",
    `${PRODUCT_NAME}의 Server와 Web Page 요구사항을 정의한다.`,
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    "| Server | [10.server.srs.md](./10.server.srs.md) | SRV | 설치형 Todo 서버 |",
    "| Web Page | [20.web-page.srs.md](./20.web-page.srs.md) | WEB | Todo 관리 웹 페이지 |",
    "",
    "## 3. Target Map",
    "",
    "| Target | Type | Status | Description |",
    "|---|---|---|---|",
    `| ${TODO_TARGET} | release | active | 설치형 Todo v1 |`,
    "",
    scopeMap,
    "## 5. Status Summary",
    "",
    "| Status | Count |",
    "|---|---:|",
    "| planned | 3 |",
    "| in_progress | 0 |",
    "| blocked | 0 |",
    "| implemented | 0 |",
    "| verified | 0 |",
    "| discarded | 0 |",
    "",
    "## 6. Requirement Type Summary",
    "",
    "| Type | Prefix | Count |",
    "|---|---|---:|",
    "| functional | FR | 2 |",
    "| interface | IR | 1 |",
    "",
    "## 7. Cross-scope Dependencies",
    "",
    "| From | To | Relation | Notes |",
    "|---|---|---|---|",
    "| WEB | SRV | depends_on | Todo 웹 페이지는 서버 API 계약을 사용한다. |",
    "",
    "## 8. Open Questions",
    "",
    "| ID | Question | Impact | Status |",
    "|---|---|---|---|",
    "",
    "## 9. Reference Documents",
    "",
    "- [SRS-MD Authoring Rules v2.5.0](../rule/SRS-MD-Rules-v2.5.0.md)",
    "",
    "## 10. Change Notes",
    "",
    "| Date | Change | Reason |",
    "|---|---|---|",
    "| 2026-05-08 | Created | integration fixture |",
    ""
  ].join("\n");
}

function renderScopeDocument(input: ScopeDocumentInput): string {
  return [
    `# ${input.heading}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    `| Scope | ${input.scope} |`,
    `| Scope Name | ${input.scopeName} |`,
    "| Version | 1.0.0 |",
    "| Last Updated | 2026-05-08 |",
    "",
    "## 1. Scope Overview",
    "",
    input.overview,
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    ...input.inScope.map((line) => `- ${line}`),
    "",
    "### Out of Scope",
    "",
    ...input.outOfScope.map((line) => `- ${line}`),
    "",
    "## 3. Assumptions and Constraints",
    "",
    ...input.assumptions.map((line) => `- ${line}`),
    "",
    "## 4. Requirements",
    "",
    input.requirements.map(renderRequirementBlock).join("\n\n"),
    "",
    "## 5. Cross-scope Dependencies",
    "",
    "| From | To | Relation | Notes |",
    "|---|---|---|---|",
    ...(input.dependencies ?? []),
    "",
    "## 6. Open Questions",
    "",
    "| ID | Question | Impact | Status |",
    "|---|---|---|---|",
    "",
    "## 7. Change Notes",
    "",
    "| Date | Change | Reason |",
    "|---|---|---|",
    "| 2026-05-08 | Created | integration fixture |",
    ""
  ].join("\n");
}

function renderRequirementBlock(input: RequirementBlockInput): string {
  return [
    `### ${input.id} — ${input.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Type | ${input.type} |`,
    `| Target | ${TODO_TARGET} |`,
    "| Status | planned |",
    "| Priority | high |",
    `| Tags | ${input.tags} |`,
    `| Risk | ${input.risk ?? "medium"} |`,
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    input.requirement,
    "",
    "#### Rationale",
    "",
    input.rationale,
    "",
    "#### Acceptance Criteria",
    "",
    ...input.acceptanceCriteria.map((criterion, index) => `- [ ] AC-${index + 1}: ${criterion}`),
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...(input.traceLinks ?? []),
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    `- ${input.implementationNotes}`,
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-05-08 | Created | integration fixture |"
  ].join("\n");
}

async function createTodoWorkspace(options: { omitScopeMap?: boolean } = {}): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), "speckiwi-todo-installable-"));
  const specDir = path.join(rootPath, "docs", "spec");
  const ruleDir = path.join(rootPath, "docs", "rule");

  await mkdir(specDir, { recursive: true });
  await mkdir(ruleDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndex(options), "utf8");
  await writeFile(
    path.join(specDir, "10.server.srs.md"),
    renderScopeDocument({
      heading: "Server SRS",
      scope: SERVER_SCOPE,
      scopeName: "Server",
      overview: "설치형 Todo 서버 요구사항을 정의한다.",
      inScope: ["Todo CRUD API"],
      outOfScope: ["외부 동기화"],
      assumptions: ["설치형 배포는 단일 사용자 로컬 환경을 기본으로 한다."],
      requirements: [
        {
          id: "FR-SRV-001",
          title: "Todo 서버 CRUD 제공",
          type: "functional",
          requirement: "설치형 Todo 서버는 Todo 항목을 생성, 조회, 수정, 삭제할 수 있어야 한다.",
          rationale: "설치형 Todo 서비스의 서버는 웹 페이지가 사용할 기본 데이터 동작을 제공해야 한다.",
          acceptanceCriteria: [
            "새 Todo 항목을 생성할 수 있다.",
            "저장된 Todo 항목 목록을 조회할 수 있다.",
            "기존 Todo 항목의 제목과 완료 여부를 수정할 수 있다.",
            "기존 Todo 항목을 삭제할 수 있다."
          ],
          implementationNotes: "Todo 항목은 설치형 로컬 저장소에 보관한다고 가정한다.",
          tags: "todo, server"
        },
        {
          id: "IR-SRV-001",
          title: "Todo REST API 계약 제공",
          type: "interface",
          requirement: "설치형 Todo 서버는 웹 페이지가 호출할 Todo REST API 계약을 제공해야 한다.",
          rationale: "웹 페이지와 서버가 같은 Todo 동작을 일관되게 사용하려면 API 계약이 필요하다.",
          acceptanceCriteria: ["GET /todos는 Todo 목록을 반환한다.", "POST /todos는 새 Todo를 생성한다."],
          traceLinks: ["| Requirement | FR-SRV-001 | supports | server behavior |"],
          implementationNotes: "REST API 응답은 Todo 항목의 제목과 완료 여부를 포함한다고 가정한다.",
          tags: "todo, server, api"
        }
      ]
    }),
    "utf8"
  );
  await writeFile(
    path.join(specDir, "20.web-page.srs.md"),
    renderScopeDocument({
      heading: "Web Page SRS",
      scope: WEB_SCOPE,
      scopeName: "Web Page",
      overview: "설치형 Todo 웹 페이지 요구사항을 정의한다.",
      inScope: ["Todo 목록 표시", "Todo 생성 UI"],
      outOfScope: ["모바일 앱"],
      assumptions: ["웹 페이지는 설치형 서버의 Todo REST API를 호출한다."],
      requirements: [
        {
          id: "FR-WEB-001",
          title: "Todo 목록과 생성 UI 제공",
          type: "functional",
          requirement: "Todo 웹 페이지는 Todo 목록을 표시하고 새 Todo를 생성할 수 있어야 한다.",
          rationale: "설치형 Todo 사용자는 브라우저에서 Todo 목록을 보고 새 항목을 추가할 수 있어야 한다.",
          acceptanceCriteria: [
            "사용자는 Todo 목록을 볼 수 있다.",
            "사용자는 새 Todo 제목을 입력해 항목을 추가할 수 있다."
          ],
          traceLinks: ["| Requirement | IR-SRV-001 | depends_on | API contract |"],
          implementationNotes: "초기 화면은 서버에서 반환한 Todo 목록을 렌더링한다고 가정한다.",
          tags: "todo, web"
        }
      ],
      dependencies: ["| WEB | SRV | depends_on | Todo 웹 페이지는 Todo REST API 계약을 사용한다. |"]
    }),
    "utf8"
  );
  await writeFile(
    path.join(ruleDir, "SRS-MD-Rules-v2.5.0.md"),
    ["# SRS-MD Authoring Rules v2.5.0", "", "Fixture copy for integration testing.", ""].join("\n"),
    "utf8"
  );

  return rootPath;
}

async function parseTodoWorkspace(rootPath: string): Promise<ParsedWorkspace> {
  const projectRoot = await resolveProjectRoot(rootPath, rootPath);
  return parseWorkspace(projectRoot);
}

async function expectValidWorkspace(rootPath: string): Promise<ValidationResult> {
  const validation = validateWorkspace(await parseTodoWorkspace(rootPath));

  expect(validation.errors).toHaveLength(0);
  return validation;
}

function expectRequirementIds(records: Array<{ id: string }>, expected: string[]): void {
  expect(records.map((record) => record.id)).toEqual(expected);
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function readRecords(value: unknown): RequirementRecord[] {
  const record = asRecord(value);

  expect(Array.isArray(record.records)).toBe(true);
  return record.records as RequirementRecord[];
}

function captureWritable(append: (text: string) => void): NodeJS.WriteStream {
  return new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      void encoding;
      append(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      callback();
    }
  }) as NodeJS.WriteStream;
}

async function runCliJson(args: string[]): Promise<CliJsonResult> {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: captureWritable((text) => {
      stdout += text;
    }),
    stderr: captureWritable((text) => {
      stderr += text;
    })
  });
  return {
    code,
    json: stdout.trim() ? JSON.parse(stdout) : undefined,
    stdout,
    stderr
  };
}

function createTodoMcpServer(root: string): McpServerHandle {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return server;
}

function expectMcpSuccess<T>(result: unknown): T {
  const record = asRecord(result);

  expect(record.ok).toBe(true);
  return record.value as T;
}

function expectMcpFailure(result: unknown): McpError {
  const record = asRecord(result);

  expect(record.ok).toBe(false);
  const error = asRecord(record.error);
  expect(error.message).toEqual(expect.any(String));
  return error as McpError;
}

describe("todo installable SRS workflow", () => {
  it("creates the generated Todo SRS workspace", async () => {
    const rootPath = await createTodoWorkspace();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const serverPath = path.join(rootPath, "docs", "spec", "10.server.srs.md");
    const webPath = path.join(rootPath, "docs", "spec", "20.web-page.srs.md");
    const rulePath = path.join(rootPath, "docs", "rule", "SRS-MD-Rules-v2.5.0.md");
    const indexText = await readFile(indexPath, "utf8");

    expect(rootPath).toContain("speckiwi-todo-installable-");
    await expect(readFile(serverPath, "utf8")).resolves.toContain("### FR-SRV-001 — Todo 서버 CRUD 제공");
    await expect(readFile(webPath, "utf8")).resolves.toContain("### FR-WEB-001 — Todo 목록과 생성 UI 제공");
    await expect(readFile(rulePath, "utf8")).resolves.toContain("# SRS-MD Authoring Rules v2.5.0");
    expect(indexText).toContain(PRODUCT_NAME);
    expect(serverPath.endsWith(".srs.md")).toBe(true);
    expect(webPath.endsWith(".srs.md")).toBe(true);
  });

  it("parses and validates a generated two-scope Todo SRS workspace", async () => {
    const rootPath = await createTodoWorkspace();
    const workspace = await parseTodoWorkspace(rootPath);

    expect(workspace.index.targets).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: TODO_TARGET, status: "active" })])
    );
    expect(workspace.index.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: SERVER_SCOPE, scope: "Server" }),
        expect.objectContaining({ prefix: WEB_SCOPE, scope: "Web Page" })
      ])
    );
    expect(workspace.files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining(["docs/spec/10.server.srs.md", "docs/spec/20.web-page.srs.md"])
    );
    expect(workspace.records.map((record) => record.id)).toEqual(
      expect.arrayContaining(["FR-SRV-001", "IR-SRV-001", "FR-WEB-001"])
    );

    const serverCrud = workspace.records.find((record) => record.id === "FR-SRV-001");
    expect(serverCrud).toBeDefined();
    expect(serverCrud).toMatchObject({
      type: "functional",
      target: TODO_TARGET,
      status: "planned",
      scope: SERVER_SCOPE
    });
    expect(serverCrud?.requirement).toContain("Todo 항목을 생성, 조회, 수정, 삭제");
    expect(serverCrud?.acceptanceCriteria).toHaveLength(4);
    expect(serverCrud?.acceptanceCriteria[0]).toMatchObject({
      id: "AC-1",
      text: "새 Todo 항목을 생성할 수 있다.",
      checked: false
    });
    expect(serverCrud?.verificationEvidence).toEqual([]);

    const serverApi = workspace.records.find((record) => record.id === "IR-SRV-001");
    const webList = workspace.records.find((record) => record.id === "FR-WEB-001");
    expect(serverApi?.traceLinks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "Requirement", reference: "FR-SRV-001" })])
    );
    expect(webList?.traceLinks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "Requirement", reference: "IR-SRV-001" })])
    );

    const validation = validateWorkspace(workspace);
    expect(validation.errors).toHaveLength(0);
    expect(validation.warnings).toHaveLength(0);

    const webRecords = listRequirements(workspace, { scope: WEB_SCOPE });
    expectRequirementIds(webRecords, ["FR-WEB-001"]);
    expect(webRecords[0]).toMatchObject({ id: "FR-WEB-001", scope: WEB_SCOPE, target: TODO_TARGET, status: "planned" });

    const serverRecords = listRequirements(workspace, { scope: SERVER_SCOPE });
    expectRequirementIds(serverRecords, ["FR-SRV-001", "IR-SRV-001"]);
    expect(serverRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "FR-SRV-001", scope: SERVER_SCOPE, target: TODO_TARGET, status: "planned" }),
        expect.objectContaining({ id: "IR-SRV-001", scope: SERVER_SCOPE, target: TODO_TARGET, status: "planned" })
      ])
    );

    const missingScopeMapRoot = await createTodoWorkspace({ omitScopeMap: true });
    const missingScopeMapValidation = validateWorkspace(await parseTodoWorkspace(missingScopeMapRoot));
    expect(missingScopeMapValidation.errors.map((error) => error.code)).toContain("SRS-E014");
  });

  it("reads the generated Todo SRS through CLI JSON commands", async () => {
    const rootPath = await createTodoWorkspace();

    const validation = await runCliJson(["--root", rootPath, "validate", "--json"]);
    expect(validation.code).toBe(0);
    expect(asRecord(validation.json).errors).toEqual([]);

    const listed = await runCliJson(["--root", rootPath, "list", "--scope", WEB_SCOPE, "--json"]);
    expect(listed.code).toBe(0);
    expectRequirementIds(readRecords(listed.json), ["FR-WEB-001"]);

    const shown = await runCliJson(["--root", rootPath, "show", "FR-SRV-001", "--json", "--markdown"]);
    expect(shown.code).toBe(0);
    expect(asRecord(shown.json).markdown).toEqual(expect.stringContaining("Todo 항목을 생성, 조회, 수정, 삭제"));

    const summary = await runCliJson(["--root", rootPath, "summary", "--target", TODO_TARGET, "--json"]);
    expect(summary.code).toBe(0);
    expect(summary.json).toMatchObject({ total: 3, countsByStatus: { planned: 3 } });

    const missing = await runCliJson(["--root", rootPath, "show", "MISSING", "--json"]);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toBe("");
    expect(missing.json).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("Requirement not found") },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { command: "search" }
    });
  });

  it("reads, mutates, and revalidates the generated Todo SRS through MCP tools", async () => {
    const rootPath = await createTodoWorkspace();
    const webPath = path.join(rootPath, "docs", "spec", "20.web-page.srs.md");
    const server = createTodoMcpServer(rootPath);

    const listed = expectMcpSuccess<{ records: RequirementRecord[] }>(await server.callTool("list_requirements", { scope: SERVER_SCOPE }));
    expectRequirementIds(listed.records, ["FR-SRV-001", "IR-SRV-001"]);

    const shown = expectMcpSuccess<RequirementRecord>(await server.callTool("get_requirement", { id: "FR-WEB-001", includeMarkdown: true }));
    expect(shown.markdown).toContain("Todo 목록과 생성 UI 제공");

    const validation = expectMcpSuccess<ValidationResult>(await server.callTool("validate_spec", {}));
    expect(validation.errors).toHaveLength(0);

    const initialSummary = expectMcpSuccess<{ total: number }>(await server.callTool("summarize_target", { target: TODO_TARGET }));
    expect(initialSummary.total).toBe(3);

    const missing = expectMcpFailure(await server.callTool("get_requirement", { id: "MISSING", includeMarkdown: true }));
    expect(missing.message).toContain("Requirement not found");

    const beforeInvalidAdd = await readFile(webPath, "utf8");
    const invalidAdd = expectMcpFailure(
      await server.callTool("add_requirement", {
        type: "functional",
        scope: WEB_SCOPE,
        target: TODO_TARGET,
        title: "누락",
        acceptanceCriteria: ["생성된다."]
      })
    );
    expect(invalidAdd.message).toContain("requires requirement");
    await expect(readFile(webPath, "utf8")).resolves.toBe(beforeInvalidAdd);

    const added = expectMcpSuccess<{ requirementId: string; filePath: string; written: boolean }>(
      await server.callTool("add_requirement", {
        type: "functional",
        scope: WEB_SCOPE,
        target: TODO_TARGET,
        title: "완료 필터 UI 제공",
        requirement: "Todo 웹 페이지는 완료 여부에 따라 Todo 항목을 필터링할 수 있어야 한다.",
        acceptanceCriteria: ["완료된 Todo만 볼 수 있다."],
        rationale: "설치형 Todo 사용자는 완료된 작업과 남은 작업을 분리해 확인해야 한다.",
        changeNotes: "2026-05-08 | Added | integration test"
      })
    );
    expect(added).toMatchObject({
      requirementId: "FR-WEB-002",
      filePath: "docs/spec/20.web-page.srs.md",
      written: true
    });

    const webText = await readFile(webPath, "utf8");
    expect(webText).toContain("### FR-WEB-002 — 완료 필터 UI 제공");
    expect(webText).toContain("| 2026-05-08 | Added | integration test |");

    await expectValidWorkspace(rootPath);
    const nextWorkspace = await parseTodoWorkspace(rootPath);
    expectRequirementIds(listRequirements(nextWorkspace, { scope: WEB_SCOPE }), ["FR-WEB-001", "FR-WEB-002"]);
    expect(summarizeTarget(nextWorkspace, TODO_TARGET).total).toBe(4);

    const nextSummary = expectMcpSuccess<{ total: number }>(await server.callTool("summarize_target", { target: TODO_TARGET }));
    expect(nextSummary.total).toBe(4);
  });
});
