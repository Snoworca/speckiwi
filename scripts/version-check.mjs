import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runNpmPackDryRun() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--ignore-scripts", "--json"]
    : ["pack", "--dry-run", "--ignore-scripts", "--json"];
  const options = npmExecPath ? {} : { shell: process.platform === "win32" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return run(command, args, options);
    } catch (error) {
      const output = `${error instanceof Error ? error.message : ""}\n${typeof error === "object" && error && "stdout" in error ? String(error.stdout) : ""}`;
      if (!output.includes("EOF") || attempt === 2) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
  fail("npm pack dry-run did not return output");
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const rootLock = lock.packages?.[""];

assert(pkg.name === "speckiwi", "package.json name must be speckiwi");
assert(lock.name === pkg.name, `package-lock name ${lock.name} does not match package.json ${pkg.name}`);
assert(rootLock?.name === pkg.name, `package-lock root name ${rootLock?.name} does not match package.json ${pkg.name}`);
assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version), `package.json version is not semver-like: ${pkg.version}`);
assert(lock.version === pkg.version, `package-lock version ${lock.version} does not match package.json ${pkg.version}`);
assert(rootLock?.version === pkg.version, `package-lock root version ${rootLock?.version} does not match package.json ${pkg.version}`);
assert(JSON.stringify(rootLock?.dependencies ?? {}) === JSON.stringify(pkg.dependencies ?? {}), "package-lock root dependencies do not match package.json dependencies");
assert(!Object.prototype.hasOwnProperty.call(pkg.dependencies ?? {}, "speckiwi"), "package.json must not depend on itself");
assert(!Object.prototype.hasOwnProperty.call(rootLock?.dependencies ?? {}, "speckiwi"), "package-lock root must not depend on speckiwi");
assert(!Object.prototype.hasOwnProperty.call(lock.packages ?? {}, "node_modules/speckiwi"), "package-lock must not include registry node_modules/speckiwi");

const cliVersion = run(process.execPath, ["bin/speckiwi", "--version"]);
assert(cliVersion === pkg.version, `CLI version ${cliVersion} does not match package.json ${pkg.version}`);

const packOutput = await runNpmPackDryRun();
const [pack] = JSON.parse(packOutput);
assert(pack?.id === `${pkg.name}@${pkg.version}`, `pack id ${pack?.id} does not match ${pkg.name}@${pkg.version}`);
assert(pack?.filename === `${pkg.name}-${pkg.version}.tgz`, `pack filename ${pack?.filename} does not match ${pkg.name}-${pkg.version}.tgz`);

process.stdout.write(`package version check passed: ${pkg.version}\n`);
