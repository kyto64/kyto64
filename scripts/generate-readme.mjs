#!/usr/bin/env node
/**
 * kyto.jp/human.md から GitHub プロフィール README を組み立てる。
 * 依存パッケージなし。失敗時は何も書き込まず終了する。
 *
 * CI は Bot Fight Mode 回避のため workers.dev から同内容を取得することがあるが、
 * README のリンクと生成元コメントは常に公開 URL（HUMAN_MD_URL）を指す。
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HUMAN_MD_URL = "https://kyto.jp/human.md";

const REQUIRED_SECTIONS = ["about"];

const OPTIONAL_LIST_SECTIONS = ["now", "made", "contributions"];
const OPTIONAL_PROSE_SECTIONS = ["stack", "likes", "work-with-me"];

const SECTION_ALIASES = new Map([
  ["about", "about"],
  ["now", "now"],
  ["made", "made"],
  ["stuff i made", "made"],
  ["contributions", "contributions"],
  ["community contributions", "contributions"],
  ["stack", "stack"],
  ["likes", "likes"],
  ["work with me", "work-with-me"],
  ["links", "links"],
]);

const README_SECTIONS = [
  { key: "now", heading: "🚧 Now" },
  { key: "made", heading: "🛠️ Stuff I Made" },
  { key: "contributions", heading: "🧩 Community Contributions" },
  { key: "stack", heading: "🧰 Stack" },
  { key: "likes", heading: "❤️ Likes" },
  { key: "work-with-me", heading: "✉️ Work with me" },
];

export class GenerateError extends Error {
  constructor(message) {
    super(message);
    this.name = "GenerateError";
  }
}

export function generateReadme(source) {
  const sections = parseHumanMd(source);
  return renderReadme(sections);
}

export function parseHumanMd(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new GenerateError("human.md が空です");
  }

  if (looksLikeHtml(source)) {
    throw new GenerateError(
      "human.md が HTML を返しました。Markdown 本文を取得できていません",
    );
  }

  const sections = splitSections(source);

  for (const key of REQUIRED_SECTIONS) {
    if (!sections.has(key)) {
      throw new GenerateError(`必須の節が見つかりません: ${displayName(key)}`);
    }
  }

  const parsed = new Map();
  for (const [key, body] of sections) {
    if (key === "links") continue;
    if (!isKnownContentSection(key)) continue;
    parsed.set(key, parseSectionBody(key, body));
  }

  for (const key of REQUIRED_SECTIONS) {
    const section = parsed.get(key);
    if (!section || isEmptySection(section)) {
      throw new GenerateError(`必須の節が空です: ${displayName(key)}`);
    }
  }

  return parsed;
}

function looksLikeHtml(source) {
  const head = source.slice(0, 400).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("just a moment...")
  );
}

function splitSections(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const sections = new Map();
  let current = null;
  let buf = [];

  const flush = () => {
    if (!current) return;
    sections.set(current, buf.join("\n").trim());
    buf = [];
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (!match) {
      if (current) buf.push(line);
      continue;
    }

    flush();
    const alias = SECTION_ALIASES.get(match[1].trim().toLowerCase());
    current = alias ?? null;
  }
  flush();

  return sections;
}

function parseSectionBody(key, body) {
  if (!body) {
    throw new GenerateError(`節が空です: ${displayName(key)}`);
  }

  const lines = body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

  const listLines = lines.filter((line) => line.trim().startsWith("- "));
  const proseLines = lines.filter((line) => !line.trim().startsWith("- "));
  const expectList = OPTIONAL_LIST_SECTIONS.includes(key);

  if (expectList || listLines.length) {
    if (proseLines.length > 0) {
      throw new GenerateError(
        expectList
          ? `節 ${displayName(key)} にリスト以外の行があります`
          : `節 ${displayName(key)} の形式が混在しています`,
      );
    }
    if (listLines.length === 0) {
      throw new GenerateError(
        `節 ${displayName(key)} に想定した項目がありません`,
      );
    }
    return {
      kind: "list",
      items: lines.flatMap((line) => expandItem(parseItem(key, line))),
    };
  }

  return { kind: "prose", text: body.trim() };
}

const ITEM_RE =
  /^- \*\*(.+?)\*\*((?:\s+\([^)]+\))*)\s+[—–−-]\s+(.+)$/;
const URL_RE = /https?:\/\/[^\s,]+/g;

export function parseItem(sectionKey, line) {
  const match = line.trim().match(ITEM_RE);
  if (!match) {
    throw new GenerateError(
      `節 ${displayName(sectionKey)} の項目形式が想定と違います: ${line}`,
    );
  }

  const name = `${match[1].trim()}${match[2] ?? ""}`.replace(/\s+/g, " ").trim();
  const rest = match[3].trim();
  if (!name) {
    throw new GenerateError(
      `節 ${displayName(sectionKey)} の項目名が空です: ${line}`,
    );
  }

  const urls = [...rest.matchAll(URL_RE)].map((found) =>
    stripTrailingPunctuation(found[0]),
  );
  let description = rest;
  for (const url of urls) {
    description = description.replace(url, "");
  }
  description = description.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();

  return { name, description, url: urls[0] ?? "", urls };
}

function expandItem(item) {
  const urls = item.urls.length > 0 ? item.urls : [item.url || ""];
  return urls.map((url) => ({
    name: item.name,
    description: item.description,
    url,
  }));
}

function stripTrailingPunctuation(url) {
  return url.replace(/[),.;]+$/u, "");
}

function isKnownContentSection(key) {
  return (
    key === "about" ||
    OPTIONAL_LIST_SECTIONS.includes(key) ||
    OPTIONAL_PROSE_SECTIONS.includes(key)
  );
}

function isEmptySection(section) {
  if (section.kind === "list") return section.items.length === 0;
  return !section.text;
}

function displayName(key) {
  switch (key) {
    case "about":
      return "About";
    case "now":
      return "Now";
    case "made":
      return "Made";
    case "contributions":
      return "Contributions";
    case "stack":
      return "Stack";
    case "likes":
      return "Likes";
    case "work-with-me":
      return "Work with me";
    default:
      return key;
  }
}

function renderReadme(sections) {
  const about = sections.get("about");
  const aboutText =
    about.kind === "prose" ? about.text : renderItems("about", about.items);

  const blocks = [
    `<!-- この README は ${HUMAN_MD_URL} から自動生成されています -->`,
    "",
    "# About Me",
    "",
    "Hi there.<br>I'm [Keito Kira](https://kyto.jp) from Japan🗾",
    "",
    aboutText,
  ];

  for (const spec of README_SECTIONS) {
    const section = sections.get(spec.key);
    if (!section) continue;
    if (section.kind === "list") {
      const items = itemsForSection(spec.key, section, sections);
      if (items.length === 0) continue;
      blocks.push("", `## ${spec.heading}`, "", renderItems(spec.key, items));
      continue;
    }
    blocks.push("", `## ${spec.heading}`, "", section.text);
  }

  return `${blocks.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function itemsForSection(key, section, sections) {
  if (key !== "made") return section.items;

  const now = sections.get("now");
  const nowNames = new Set(
    (now?.kind === "list" ? now.items : []).map((item) => normalizeName(item.name)),
  );
  return section.items.filter((item) => !nowNames.has(normalizeName(item.name)));
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function renderItems(sectionKey, items) {
  return items.map((item) => renderItem(sectionKey, item)).join("\n");
}

function renderItem(sectionKey, item) {
  const description = resolveDescription(sectionKey, item);
  const label = description ? `${item.name} - ${description}` : item.name;
  if (item.url) {
    return `- [${label}](${item.url})`;
  }
  return `- ${label}`;
}

function resolveDescription(sectionKey, item) {
  if (item.description) return item.description;
  if (sectionKey !== "contributions") return "";
  const pr = prNumberFromUrl(item.url);
  return pr ? `#${pr}` : "";
}

function prNumberFromUrl(url) {
  if (!url) return "";
  const match = url.match(/\/pull\/(\d+)/);
  return match ? match[1] : "";
}

function isDirectRun(argv1) {
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(resolve(argv1)).href;
}

function main(argv) {
  const inputPath = argv[0];
  const outputPath = argv[1];

  if (!inputPath) {
    console.error("使い方: node scripts/generate-readme.mjs <human.md> [README.md]");
    process.exit(2);
  }

  let source;
  try {
    source = readFileSync(inputPath, "utf8");
  } catch (error) {
    console.error(`human.md を読めません: ${error.message}`);
    process.exit(1);
  }

  let readme;
  try {
    readme = generateReadme(source);
  } catch (error) {
    const message = error instanceof GenerateError ? error.message : error.stack;
    console.error(message);
    process.exit(1);
  }

  if (!outputPath) {
    process.stdout.write(readme);
    return;
  }

  const tmpPath = `${outputPath}.tmp`;
  try {
    writeFileSync(tmpPath, readme);
    renameSync(tmpPath, outputPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    console.error(`README を書けません: ${error.message}`);
    process.exit(1);
  }
}

if (isDirectRun(process.argv[1])) {
  main(process.argv.slice(2));
}
