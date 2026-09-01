const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.js'), 'utf8');

test('home page includes an accessible selected-profile organization menu', () => {
  assert.match(html, /id="organizeSelectedBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/u);
  assert.match(html, /id="organizeSelectedMenu"[^>]*role="menu"[^>]*hidden/u);
  assert.match(html, /id="organizeWorkspaceMenu"[^>]*role="menu"/u);
  assert.match(html, /data-organize-action="favorite"/u);
  assert.match(html, /data-organize-action="unfavorite"/u);
  assert.match(html, /data-organize-action="export"/u);
});

test('batch organizer module loads before the home-page entry point', () => {
  assert.ok(html.indexOf('profile-batch-organizer.js') < html.indexOf('index.js'));
  assert.match(source, /window\.profileBatchOrganizer/u);
  assert.match(source, /assignProfilesWorkspace/u);
  assert.match(source, /setProfilesFavorite/u);
  assert.match(source, /exportSelectedProfiles/u);
});
