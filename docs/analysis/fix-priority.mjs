import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "C:/Work/git/_Snoworca/speckiwi";
const files = [
  "docs/spec/20.parser-validation.srs.md",
  "docs/spec/30.cli-interface.srs.md",
  "docs/spec/40.mcp-stdio-interface.srs.md",
  "docs/spec/50.nodejs-implementation.srs.md",
  "docs/spec/60.workflow-release.srs.md",
];
let total = 0;
for (const f of files) {
  const p = `${ROOT}/${f}`;
  const src = readFileSync(p, "utf8");
  const count = (src.match(/\| Priority \| P2 \|/g) || []).length;
  if (count) {
    writeFileSync(p, src.split("| Priority | P2 |").join("| Priority | high |"), "utf8");
    total += count;
  }
  console.log(`${f}: ${count}`);
}
console.log(`total replaced=${total}`);
