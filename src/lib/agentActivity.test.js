// Agent activity aggregation contracts: status windows, durations,
// ranges, leaderboard shaping. Pure logic, no SiDB access.
// Run with: node --test src/lib/agentActivity.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  agentStatus,
  sessionActiveSeconds,
  totalActiveSeconds,
  formatDuration,
  rangeStart,
  summarizeAgents,
  ONLINE_WINDOW_MS,
  IDLE_WINDOW_MS,
} from './agentActivity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const NOW = new Date('2026-10-13T12:00:00Z').getTime();
const iso = (ms) => new Date(ms).toISOString();

describe('presence windows', () => {
  it('classifies online / idle / offline by heartbeat recency', () => {
    assert.equal(ONLINE_WINDOW_MS, 2 * 60 * 1000);
    assert.equal(IDLE_WINDOW_MS, 15 * 60 * 1000);
    assert.equal(agentStatus(iso(NOW - 30_000), NOW), 'online');
    assert.equal(agentStatus(iso(NOW - 5 * 60_000), NOW), 'idle');
    assert.equal(agentStatus(iso(NOW - 60 * 60_000), NOW), 'offline');
    assert.equal(agentStatus(null, NOW), 'offline');
    assert.equal(agentStatus('bogus', NOW), 'offline');
  });
});

describe('durations', () => {
  it('measures closed and open sessions, ignoring bad data', () => {
    assert.equal(
      sessionActiveSeconds({ login_at: iso(NOW - 3600_000), logout_at: iso(NOW) }, NOW),
      3600
    );
    assert.equal(sessionActiveSeconds({ login_at: iso(NOW - 90_000) }, NOW), 90);
    assert.equal(sessionActiveSeconds({ login_at: iso(NOW), logout_at: iso(NOW - 1000) }, NOW), 0);
    assert.equal(sessionActiveSeconds({}, NOW), 0);
    assert.equal(totalActiveSeconds([
      { login_at: iso(NOW - 3600_000), logout_at: iso(NOW) },
      { login_at: iso(NOW - 60_000) },
    ], NOW), 3660);
  });

  it('formats hours and minutes', () => {
    assert.equal(formatDuration(45), '45s');
    assert.equal(formatDuration(90), '1m');
    assert.equal(formatDuration(3660), '1h 1m');
    assert.equal(formatDuration(-5), '0s');
  });
});

describe('ranges and leaderboard', () => {
  it('computes day-bucketed range starts', () => {
    const startOfLocalDay = new Date(NOW);
    startOfLocalDay.setHours(0, 0, 0, 0);
    assert.equal(new Date(rangeStart('today', NOW)).getTime(), startOfLocalDay.getTime());
    assert.ok(new Date(rangeStart('7d', NOW)).getTime() < new Date(rangeStart('today', NOW)).getTime());
    assert.ok(new Date(rangeStart('30d', NOW)).getTime() < new Date(rangeStart('7d', NOW)).getTime());
  });

  it('summarizes per-agent rows with profile fallback', () => {
    const rows = [
      { user_id: 'u1', login_at: iso(NOW - 3600_000), logout_at: iso(NOW), last_heartbeat_at: iso(NOW), is_active: false },
      { user_id: 'u1', login_at: iso(NOW - 60_000), last_heartbeat_at: iso(NOW - 30_000), is_active: true },
      { user_id: 'u2', login_at: iso(NOW - 600_000), last_heartbeat_at: iso(NOW - 600_000), is_active: true },
    ];
    const out = summarizeAgents(rows, { u1: { full_name: 'Ann', job_title: 'PM' } }, NOW);
    assert.equal(out.length, 2);
    const ann = out.find((a) => a.userId === 'u1');
    assert.equal(ann.name, 'Ann');
    assert.equal(ann.jobTitle, 'PM');
    assert.equal(ann.status, 'online');
    assert.equal(ann.totalSeconds, 3660);
    const ghost = out.find((a) => a.userId === 'u2');
    assert.equal(ghost.name, 'Unknown');
    assert.equal(ghost.status, 'idle');
  });
});

describe('dashboard wiring', () => {
  it('mounts queries non-blockingly with caps', () => {
    const src = read('src/components/teams/AgentActivityDashboard.jsx');
    assert.ok(src.includes('.limit(500)'), 'sessions capped');
    assert.ok(src.includes('.range('), 'feed paginated');
    assert.ok(src.includes('enabled: active'), 'lazy queries');
    assert.ok(!src.includes('setInterval'), 'no polling loops');
  });

  it('nests inside Teams tabs without touching member logic', () => {
    const teams = read('src/pages/Teams.jsx');
    assert.ok(teams.includes('<AgentActivityDashboard active={activeTab === '), 'gated mount');
    assert.ok(teams.includes("value=\"members\"") || teams.includes("value='members'"), 'members tab kept');
  });
});
