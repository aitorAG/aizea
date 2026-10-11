const {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} = require("node:fs");
const { join, relative, sep } = require("node:path");

// These are the files generated or checked into public that the installed app
// can serve without containing user data. Runtime uploads and extracted figures
// live in the per-user data directory in desktop mode.
const RELEASE_PUBLIC_FILES = new Set([
  "manifest.webmanifest",
  "offline.html",
  "sw.js",
]);
const RELEASE_PUBLIC_DIRECTORIES = new Set(["icons"]);
const REQUIRED_PUBLIC_FILES = ["manifest.webmanifest", "offline.html", "sw.js"];
const REQUIRED_PUBLIC_ICONS = [
  "apple-touch-icon.png",
  "pwa-192x192.png",
  "pwa-512x512.png",
];

const FORBIDDEN_SEGMENTS = new Set([
  "uploads",
  "test",
  "tests",
  "__tests__",
  "test-results",
  "playwright-report",
  ".artifacts",
]);

function toPortablePath(value) {
  return value.split(sep).join("/");
}

function relativePath(root, fullPath) {
  return toPortablePath(relative(root, fullPath));
}

function copyReleasePublicAssets(publicRoot, destinationRoot) {
  rmSync(destinationRoot, { recursive: true, force: true });
  if (!existsSync(publicRoot)) {
    throw new Error(`Public assets directory not found: ${publicRoot}`);
  }

  mkdirSync(destinationRoot, { recursive: true });
  const copied = [];

  for (const name of [...RELEASE_PUBLIC_FILES].sort()) {
    const source = join(publicRoot, name);
    if (!existsSync(source)) continue;
    if (!lstatSync(source).isFile()) {
      throw new Error(`Release public asset is not a regular file: ${name}`);
    }
    cpSync(source, join(destinationRoot, name));
    copied.push(name);
  }

  for (const name of readdirSync(publicRoot).sort()) {
    if (!/^workbox-[a-z0-9]+\.js$/i.test(name)) continue;
    const source = join(publicRoot, name);
    if (!lstatSync(source).isFile()) {
      throw new Error(`Release public asset is not a regular file: ${name}`);
    }
    cpSync(source, join(destinationRoot, name));
    copied.push(name);
  }

  for (const name of [...RELEASE_PUBLIC_DIRECTORIES].sort()) {
    const source = join(publicRoot, name);
    if (!existsSync(source)) continue;
    if (!lstatSync(source).isDirectory()) {
      throw new Error(`Release public asset is not a directory: ${name}`);
    }
    cpSync(source, join(destinationRoot, name), { recursive: true });
    copied.push(`${name}/`);
  }

  const missing = [
    ...REQUIRED_PUBLIC_FILES.filter((name) => !existsSync(join(destinationRoot, name))),
    ...REQUIRED_PUBLIC_ICONS
      .filter((name) => !existsSync(join(destinationRoot, "icons", name)))
      .map((name) => `icons/${name}`),
  ];
  if (missing.length > 0) {
    throw new Error(`Required release public assets are missing: ${missing.join(", ")}`);
  }

  return copied;
}

function isForbiddenPayloadPath(relativeName) {
  const segments = relativeName.toLowerCase().split("/");
  const basename = segments[segments.length - 1];
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return true;
  if (segments[0] === "public" && segments[1] === "figures") return true;
  if (basename.endsWith(".db") && basename !== "db.sqlite") return true;
  if (basename.endsWith(".map")) return true;
  if (basename.endsWith(".log") || basename.endsWith(".test") || basename.endsWith(".spec")) {
    return true;
  }
  if (/\.(test|spec)\.[^.]+$/.test(basename)) return true;
  return false;
}

function collectFiles(root, current = root, files = []) {
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    const name = relativePath(root, fullPath);
    if (entry.isSymbolicLink()) {
      files.push({ path: name, size: 0, forbidden: true });
    } else if (entry.isDirectory()) {
      collectFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      files.push({ path: name, size: statSync(fullPath).size, forbidden: isForbiddenPayloadPath(name) });
    }
  }
  return files;
}

function inspectStandalonePayload(root, options = {}) {
  const files = collectFiles(root);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const largestFiles = [...files]
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    .slice(0, options.largestCount || 10);
  const violations = files.filter((file) => file.forbidden).map((file) => file.path);
  return { files, largestFiles, totalBytes, violations };
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function assertStandalonePayload(root, options = {}) {
  const report = inspectStandalonePayload(root, options);
  const lines = [
    `Standalone payload: ${report.files.length} files, ${formatBytes(report.totalBytes)}`,
    "Largest files:",
    ...report.largestFiles.map((file) => `  ${formatBytes(file.size)}  ${file.path}`),
  ];
  if (report.violations.length > 0) {
    lines.push("Forbidden payload entries:", ...report.violations.map((file) => `  ${file}`));
    const error = new Error(lines.join("\n"));
    error.payloadReport = report;
    throw error;
  }
  if (options.log) options.log(lines.join("\n"));
  return report;
}

module.exports = {
  RELEASE_PUBLIC_DIRECTORIES,
  RELEASE_PUBLIC_FILES,
  REQUIRED_PUBLIC_FILES,
  REQUIRED_PUBLIC_ICONS,
  assertStandalonePayload,
  copyReleasePublicAssets,
  inspectStandalonePayload,
};
