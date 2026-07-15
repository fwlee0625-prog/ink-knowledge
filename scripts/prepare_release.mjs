import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsWithoutNode = process.argv.slice(2).filter((argument) => argument !== "--");
const checkOnly = argumentsWithoutNode[0] === "--check";
const requestedVersion = checkOnly ? undefined : argumentsWithoutNode[0];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const paths = {
  packageJson: path.join(rootDir, "package.json"),
  tauriConfig: path.join(rootDir, "src-tauri/tauri.conf.json"),
  cargoToml: path.join(rootDir, "src-tauri/Cargo.toml"),
  changelog: path.join(rootDir, "ui/src/data/changelog.json"),
  releaseConfig: path.join(rootDir, "release/config.json"),
  releaseNotes: path.join(rootDir, "release/release-notes.md"),
};

const [packageJsonText, tauriConfigText, cargoToml, changelogText, releaseConfigText] = await Promise.all([
  readFile(paths.packageJson, "utf8"),
  readFile(paths.tauriConfig, "utf8"),
  readFile(paths.cargoToml, "utf8"),
  readFile(paths.changelog, "utf8"),
  readFile(paths.releaseConfig, "utf8"),
]);

const packageJson = JSON.parse(packageJsonText);
const tauriConfig = JSON.parse(tauriConfigText);
const changelog = JSON.parse(changelogText);
const releaseConfig = JSON.parse(releaseConfigText);
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (!Array.isArray(changelog) || changelog.length === 0) {
  fail("ui/src/data/changelog.json 至少需要一条版本记录。");
}
const latest = changelog[0];
changelog.forEach(validateChangelogEntry);
const duplicateVersions = changelog
  .map((entry) => entry.version)
  .filter((version, index, versions) => versions.indexOf(version) !== index);
if (duplicateVersions.length > 0) {
  fail(`更新日志包含重复版本: ${[...new Set(duplicateVersions)].join(", ")}`);
}

if (checkOnly) {
  const expected = packageJson.version;
  validateVersion(expected, "package.json version");
  if (tauriConfig.version !== expected || cargoVersion !== expected || latest.version !== expected) {
    fail(
      `版本不一致: package=${expected}, tauri=${tauriConfig.version}, cargo=${cargoVersion}, changelog=${latest.version}`,
    );
  }
  if (!isRepository(releaseConfig.githubRepository)) {
    console.warn("warning: release/config.json 尚未配置 githubRepository，发布前必须填写 owner/repo。");
  }
  console.log(`release configuration is consistent at ${expected}`);
  process.exit(0);
}

if (!requestedVersion) {
  fail("用法: pnpm release:prepare -- 0.2.0");
}
validateVersion(requestedVersion, "发布版本");
if (latest.version !== requestedVersion) {
  fail(`更新日志第一项版本 ${latest.version} 与发布版本 ${requestedVersion} 不一致。`);
}
if (!isRepository(releaseConfig.githubRepository)) {
  fail("发布前请在 release/config.json 中填写 owner/repo 格式的 githubRepository。");
}

packageJson.version = requestedVersion;
tauriConfig.version = requestedVersion;
const nextCargoToml = cargoToml.replace(
  /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(".*$)/m,
  `$1${requestedVersion}$2`,
);
if (nextCargoToml === cargoToml && cargoVersion !== requestedVersion) {
  fail("无法更新 src-tauri/Cargo.toml 的 package version。");
}

await Promise.all([
  writeFile(paths.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(paths.tauriConfig, `${JSON.stringify(tauriConfig, null, 2)}\n`),
  writeFile(paths.cargoToml, nextCargoToml),
  writeFile(paths.releaseNotes, renderReleaseNotes(latest)),
]);

console.log(`prepared release v${requestedVersion} for ${releaseConfig.githubRepository}`);

function validateChangelogEntry(entry) {
  if (!entry || typeof entry !== "object") fail("更新日志第一项格式无效。");
  validateVersion(entry.version, "更新日志版本");
  if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    fail("更新日志日期必须使用 YYYY-MM-DD 格式。");
  }
  if (typeof entry.title !== "string" || !entry.title.trim()) fail("更新日志标题不能为空。");
  if (!Array.isArray(entry.changes) || entry.changes.length === 0 || entry.changes.some((item) => typeof item !== "string" || !item.trim())) {
    fail("更新日志 changes 必须是非空字符串数组。");
  }
}

function validateVersion(value, label) {
  if (typeof value !== "string" || !semverPattern.test(value)) fail(`${label} 不符合 SemVer: ${value}`);
}

function isRepository(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function renderReleaseNotes(entry) {
  return `## ${entry.title}\n\n${entry.changes.map((change) => `- ${change}`).join("\n")}\n`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
