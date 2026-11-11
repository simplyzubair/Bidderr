// The PPH Bidderr extension can't load files from outside its folder, so it keeps copies of the
// shared engine and UI. They must stay identical: run `cp shared/{proposal.js,ui.js,style.css} extension/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['proposal.js', 'ui.js', 'style.css']) {
  test(`extension/${file} matches shared/${file}`, () => {
    assert.equal(readFileSync(`extension/${file}`, 'utf8'), readFileSync(`shared/${file}`, 'utf8'));
  });
}

test('extension manifest is valid and never asks for broad permissions', () => {
  const m = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.content_scripts[0].matches, ['https://www.peopleperhour.com/freelance-jobs/*']);
});
