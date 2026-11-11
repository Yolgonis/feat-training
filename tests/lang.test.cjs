// Every translatable text in the module script must have a translation in each language file,
// with the same {placeholders} and HTML tags.   node --test "tests/*.test.cjs"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts", "feat-training-tracker.js"), "utf8");
// t("…") translates in place; L("…") marks a text that is translated later (setting names).
const texts = [...new Set([...source.matchAll(/\b(?:t|L)\(\s*"((?:\\.|[^"\\])*)"/g)].map(match => JSON.parse(`"${match[1]}"`)))];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
const languageFiles = fs.readdirSync(path.join(root, "scripts")).filter(file => /^lang-[a-z]+\.js$/.test(file));
for (const file of languageFiles) require(path.join(root, "scripts", file));
const languages = globalThis.FeatTrainingLanguages ?? {};

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const tags = text => (text.match(/<\/?[a-z][^>]*>/gi) ?? []).sort();

test("the script has translatable texts and no template literals inside t()", () => {
  assert.ok(texts.length > 80, `only ${texts.length} texts found`);
  assert.equal(/\b(?:t|L)\(\s*`/.test(source), false, "t(`…`) cannot be extracted; use {placeholders}");
});

test("language files are loaded before the main script", () => {
  assert.ok(languageFiles.length > 0);
  const main = manifest.scripts.indexOf("scripts/feat-training-tracker.js");
  for (const file of languageFiles) {
    const index = manifest.scripts.indexOf(`scripts/${file}`);
    assert.ok(index !== -1 && index < main, `${file} must be listed in module.json before the main script`);
  }
});

for (const [code, dictionary] of Object.entries(languages)) {
  test(`${code}: every text is translated and nothing is left over`, () => {
    assert.deepEqual(texts.filter(text => !(text in dictionary)), [], "missing translations");
    assert.deepEqual(Object.keys(dictionary).filter(text => !texts.includes(text)), [], "translations for texts that no longer exist");
  });

  test(`${code}: translations keep placeholders and HTML tags`, () => {
    for (const [text, translation] of Object.entries(dictionary)) {
      assert.ok(typeof translation === "string" && translation.trim(), `empty translation: ${text}`);
      assert.deepEqual(placeholders(translation), placeholders(text), `placeholders differ: ${text}`);
      assert.deepEqual(tags(translation), tags(text), `HTML tags differ: ${text}`);
    }
  });
}
