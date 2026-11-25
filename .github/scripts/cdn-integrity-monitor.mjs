#!/usr/bin/env node
/**
 * CDN Integrity Monitor for @newrelic/video-caf
 *
 * Fetches the latest GitHub Release asset and compares its SHA-256 digest
 * against the file served from the CDN. Exits non-zero if they differ.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REPO = 'newrelic/video-caf-js';
const S3_BASE = 'https://download.newrelic.com/media-agents/browser/caf';
const AGENT_FILE = 'newrelic-video-caf.min.js';

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function getLatestRelease() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'cdn-integrity-monitor' } }
  );
  if (!res.ok) throw new Error(`Failed to fetch latest release: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const release = await getLatestRelease();
  const version = release.tag_name.replace(/^v/, '');
  console.log(`Checking release v${version}`);

  // URLs to verify
  const checks = [
    {
      label: 'versioned',
      cdn: `${S3_BASE}/${version}/${AGENT_FILE}`,
      asset: release.assets.find(a => a.name === AGENT_FILE),
    },
    {
      label: 'latest',
      cdn: `${S3_BASE}/latest/${AGENT_FILE}`,
      asset: release.assets.find(a => a.name === AGENT_FILE),
    },
  ];

  let failed = false;

  for (const { label, cdn, asset } of checks) {
    if (!asset) {
      console.error(`No release asset named '${AGENT_FILE}' found in release ${release.tag_name}`);
      failed = true;
      continue;
    }

    const [cdnBuf, releaseBuf] = await Promise.all([
      fetchBuffer(cdn),
      fetchBuffer(asset.browser_download_url),
    ]);

    const cdnHash = sha256(cdnBuf);
    const releaseHash = sha256(releaseBuf);

    if (cdnHash === releaseHash) {
      console.log(`✅ ${label}: CDN matches release asset (${cdnHash.slice(0, 12)}…)`);
    } else {
      console.error(`❌ ${label}: MISMATCH`);
      console.error(`   CDN:     ${cdnHash}`);
      console.error(`   Release: ${releaseHash}`);
      console.error(`   CDN URL: ${cdn}`);
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
