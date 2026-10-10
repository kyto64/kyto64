import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GenerateError,
  generateReadme,
  parseHumanMd,
  parseItem,
} from "./generate-readme.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const scriptPath = join(here, "generate-readme.mjs");

function fixture(name) {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    ...options,
  });
}

test("想定 human.md から README を組み立てる", () => {
  const actual = generateReadme(fixture("human.full.md"));
  assert.equal(actual, fixture("readme.full.md"));
});

test("Contributions と Made が無いときはその節を省略する", () => {
  const actual = generateReadme(fixture("human.without-optional.md"));
  assert.equal(actual, fixture("readme.without-optional.md"));
  assert.doesNotMatch(actual, /Stuff I Made/);
  assert.doesNotMatch(actual, /Community Contributions/);
});

test("Links と公開リポジトリ一覧は README に出さない", () => {
  const actual = generateReadme(fixture("human.full.md"));
  assert.doesNotMatch(actual, /## .*Links/);
  assert.doesNotMatch(actual, /Works:/);
  assert.doesNotMatch(actual, /zenn\.dev/);
});

test("自動生成コメントと既存の雰囲気を残す", () => {
  const actual = generateReadme(fixture("human.full.md"));
  assert.match(
    actual,
    /<!-- この README は https:\/\/kyto\.jp\/human\.md から自動生成されています -->/,
  );
  assert.match(actual, /^# About Me$/m);
  assert.match(
    actual,
    /Hi there\.<br>I'm \[Keito Kira\]\(https:\/\/kyto\.jp\) from Japan🗾/,
  );
  assert.match(actual, /## 🚧 Now/);
  assert.match(actual, /## 🛠️ Stuff I Made/);
  assert.match(actual, /## 🧩 Community Contributions/);
  assert.match(actual, /## 🧰 Stack/);
  assert.match(actual, /## ❤️ Likes/);
  assert.match(actual, /## ✉️ Work with me/);
});

test("About が無いと失敗する", () => {
  const source = `## Now\n\n- **youtublur** — blur https://example.com/y\n`;
  assert.throws(() => generateReadme(source), GenerateError);
  assert.throws(() => generateReadme(source), /About/);
});

test("空の human.md は失敗する", () => {
  assert.throws(() => generateReadme(""), GenerateError);
  assert.throws(() => generateReadme("   \n"), GenerateError);
});

test("HTML（チャレンジページなど）は失敗する", () => {
  const html = `<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>`;
  assert.throws(() => generateReadme(html), GenerateError);
  assert.throws(() => generateReadme(html), /HTML/);
});

test("リスト節の項目形式が違うと失敗する", () => {
  const source = `# x

## About

hello

## Now

- youtublur is missing the expected markup
`;
  assert.throws(() => generateReadme(source), GenerateError);
  assert.throws(() => generateReadme(source), /Now/);
});

test("空のリスト節は失敗する", () => {
  const source = `# x

## About

hello

## Now

`;
  assert.throws(() => generateReadme(source), GenerateError);
  assert.throws(() => generateReadme(source), /Now/);
});

test("項目を名前・説明・URL に分解する", () => {
  assert.deepEqual(
    parseItem(
      "now",
      "- **youtublur** — a Chrome extension. https://chromewebstore.google.com/detail/npkiobfoclnkmobjhgadnjepceofjenj",
    ),
    {
      name: "youtublur",
      description: "a Chrome extension.",
      url: "https://chromewebstore.google.com/detail/npkiobfoclnkmobjhgadnjepceofjenj",
    },
  );
});

test("URL の無い項目はリンクにしない", () => {
  const parsed = parseHumanMd(fixture("human.without-optional.md"));
  const now = parsed.get("now");
  assert.equal(now.items[1].url, "");
  assert.equal(now.items[2].name, "kyto.jp");
});

test("CLI は成功時だけ出力ファイルを書き、失敗時は既存 README を残す", () => {
  const dir = mkdtempSync(join(tmpdir(), "readme-gen-"));
  const readmePath = join(dir, "README.md");
  const original = "# keep me\n";
  writeFileSync(readmePath, original);

  const ok = runCli([join(here, "fixtures", "human.full.md"), readmePath]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readFileSync(readmePath, "utf8"), fixture("readme.full.md"));

  const broken = join(dir, "broken.md");
  writeFileSync(broken, "## Now\n\n- nope\n");
  const fail = runCli([broken, readmePath]);
  assert.notEqual(fail.status, 0);
  assert.equal(readFileSync(readmePath, "utf8"), fixture("readme.full.md"));
});

test("CLI は入力省略時に使い方を出して失敗する", () => {
  const result = runCli([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /使い方/);
});
