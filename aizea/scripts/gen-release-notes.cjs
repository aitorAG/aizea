#!/usr/bin/env node
// gen-release-notes.cjs — Generate src-tauri/release-notes.rtf from the latest
// version section of CHANGELOG.md.
//
// The RTF is wired into the installer via `bundle.licenseFile` in
// tauri.conf.json, so BOTH the MSI (WiX) and the NSIS .exe show the release
// notes as a page DURING installation (not as a loose file on disk). RTF is
// the universal choice: WiX requires RTF for its license page, and NSIS
// LicenseData auto-detects and renders RTF too.
//
// Single source of truth: CHANGELOG.md. Run automatically by build-msi.cjs
// before `tauri build`, and re-runnable standalone: `node scripts/gen-release-notes.cjs`.

const { readFileSync, writeFileSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const OUT = join(ROOT, "src-tauri", "release-notes.rtf");

/** Extract the first version block: from the first "## [" heading up to (but
 *  not including) the next "## [" heading. Returns { version, title, body }. */
function extractLatestSection(md) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error("No version heading (## [x.y.z]) found in CHANGELOG.md");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const heading = lines[start];
  const versionMatch = heading.match(/## \[([^\]]+)\]/);
  const version = versionMatch ? versionMatch[1] : "";
  const body = lines.slice(start + 1, end);
  return { version, headingLine: heading, body };
}

/** Escape a plain-text string for RTF: backslash/braces, then any non-ASCII
 *  char as \uN? (signed 16-bit code unit). */
function rtfEscape(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === "{") out += "\\{";
    else if (ch === "}") out += "\\}";
    else if (code < 128) out += ch;
    else {
      // RTF \uN? uses a SIGNED 16-bit value; our symbols are all < 0x8000.
      const signed = code < 0x8000 ? code : code - 0x10000;
      out += `\\u${signed}?`;
    }
  }
  return out;
}

/** Convert one markdown line to an RTF paragraph fragment (without the
 *  trailing \par). Handles: ## / ### headings, "- " bullets, **bold**, and
 *  strips inline `code` backticks. */
function mdLineToRtf(line) {
  // Heading levels.
  let text = line;
  let prefix = "";
  let suffix = "";
  if (/^## /.test(text)) {
    text = text.replace(/^## /, "");
    prefix = "\\b\\fs28 ";
    suffix = "\\b0\\fs22";
  } else if (/^### /.test(text)) {
    text = text.replace(/^### /, "");
    prefix = "\\b\\fs24 ";
    suffix = "\\b0\\fs22";
  } else if (/^-\s+/.test(text)) {
    text = text.replace(/^-\s+/, "");
    prefix = "\\bullet  ";
  }

  // Strip inline code backticks (keep the content).
  text = text.replace(/`([^`]*)`/g, "$1");

  // Split on **bold** spans and emit \b ... \b0 around them.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  let inner = "";
  for (const part of parts) {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      inner += `{\\b ${rtfEscape(bold[1])}}`;
    } else {
      inner += rtfEscape(part);
    }
  }
  return `${prefix}${inner}${suffix}`;
}

function buildRtf() {
  const md = readFileSync(CHANGELOG, "utf-8");
  const { version, body } = extractLatestSection(md);

  const paragraphs = [];
  // Title line.
  paragraphs.push(`\\b\\fs32 AIzea ${rtfEscape(version)}\\b0\\fs22`);

  for (const raw of body) {
    const line = raw.replace(/\s+$/, "");
    if (line.length === 0) {
      paragraphs.push(""); // blank paragraph = spacing
      continue;
    }
    paragraphs.push(mdLineToRtf(line));
  }

  const header =
    "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
    "{\\fonttbl{\\f0\\fnil\\fcharset0 Segoe UI;}}" +
    "\\viewkind4\\uc1\\fs22\n";
  const content = paragraphs.map((p) => `${p}\\par`).join("\n");
  return `${header}${content}\n}`;
}

const rtf = buildRtf();
writeFileSync(OUT, rtf, "latin1"); // RTF is ansicpg1252; non-ASCII already \uN?
const { version } = extractLatestSection(readFileSync(CHANGELOG, "utf-8"));
console.log(
  `\x1b[36m[gen-release-notes]\x1b[0m Wrote ${OUT} for version ${version}`
);
