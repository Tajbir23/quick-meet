#!/usr/bin/env node
/**
 * Bump version across ALL package.json files + versions.json
 * 
 * Usage:
 *   node scripts/bump-version.js          → bump patch (1.0.0 → 1.0.1)
 *   node scripts/bump-version.js minor    → bump minor (1.0.3 → 1.1.0)
 *   node scripts/bump-version.js major    → bump major (1.2.3 → 2.0.0)
 *   node scripts/bump-version.js 2.5.0    → set exact version
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_FILES = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'desktop/package.json',
  'mobile/package.json',
];
const VERSIONS_JSON = 'server/updates/versions.json';

// Read current version from mobile/package.json (source of truth)
const mobilePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mobile/package.json'), 'utf8'));
const current = mobilePkg.version || '1.0.0';
const [major, minor, patch] = current.split('.').map(Number);

// Determine new version
const arg = process.argv[2] || 'patch';
let newVersion;

if (/^\d+\.\d+\.\d+$/.test(arg)) {
  newVersion = arg;
} else if (arg === 'major') {
  newVersion = `${major + 1}.0.0`;
} else if (arg === 'minor') {
  newVersion = `${major}.${minor + 1}.0`;
} else {
  newVersion = `${major}.${minor}.${patch + 1}`;
}

console.log(`Bumping version: ${current} → ${newVersion}\n`);

// Update all package.json files
for (const rel of PACKAGE_FILES) {
  const filePath = path.join(ROOT, rel);
  if (!fs.existsSync(filePath)) continue;
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ✔ ${rel} → ${newVersion}`);
}

// Update versions.json
const versionsPath = path.join(ROOT, VERSIONS_JSON);
let versions = {};
try { versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8')); } catch (e) {}
const now = new Date().toISOString();
for (const key of ['web', 'android', 'desktop']) {
  if (!versions[key]) versions[key] = {};
  versions[key].version = newVersion;
  versions[key].lastUpdated = now;
  if (!versions[key].minVersion) versions[key].minVersion = '1.0.0';
}
fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
console.log(`  ✔ ${VERSIONS_JSON} → ${newVersion}`);

console.log(`\nDone! All files updated to v${newVersion}`);
console.log('Run: git add -A && git commit -m "chore: bump version to v' + newVersion + '"');
