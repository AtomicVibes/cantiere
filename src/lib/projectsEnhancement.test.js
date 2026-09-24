// Projects enhancement contracts:
//   progress math (auto/manual/cap/removal) · filters/sorting · migration
//   shape + RLS safety · badge semantics · form/detail wiring · i18n.
// Run with: node --test src/lib/projectsEnhancement.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  computeAutoProgress,
  clampProgress,
  getEffectiveProgress,
  isManualProgressMode,
  getPriorityProgressClass,
  PRIORITY_PROGRESS_CLASSES,
} from './projectProgress.js';
import { matchesProjectFilters, sortProjects, priorityRank } from './projectFilters.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const MIG = 'supabase/migrations/20261008120000_project_visibility_progress.sql';

describe('progress automation contract', () => {
  it('adds 5% per submission and caps at 100%', () => {
    assert.equal(computeAutoProgress(0), 0);
    assert.equal(computeAutoProgress(1), 5);
    assert.equal(computeAutoProgress(2), 10);
    assert.equal(computeAutoProgress(10), 50);
    assert.equal(computeAutoProgress(20), 100);
    assert.equal(computeAutoProgress(21), 100);
    assert.equal(computeAutoProgress(100), 100);
  });

  it('removal reduces progress in auto mode only', () => {
    assert.equal(computeAutoProgress(10), 50);
    assert.equal(computeAutoProgress(9), 45);
    const manual = { progress_mode: 'manual', manual_progress: 72, progress: 72 };
    assert.equal(isManualProgressMode(manual), true);
    assert.equal(getEffectiveProgress(manual), 72);
  });

  it('manual override survives timeline changes; auto restores by count', () => {
    assert.equal(getEffectiveProgress({ progress_mode: 'manual', manual_progress: 72 }), 72);
    assert.equal(getEffectiveProgress({ progress_mode: 'auto', progress: 35 }), 35);
    assert.equal(getEffectiveProgress({}), 0);
    assert.equal(clampProgress(150), 100);
    assert.equal(clampProgress(-5), 0);
    assert.equal(clampProgress('72'), 72);
  });

  it('migration enforces the same rules server-side', () => {
    const sql = codeOf(read(MIG));
    assert.ok(sql.includes('least(100, v_count * 5)') || sql.includes('least(100,'), 'cap at 100');
    assert.ok(sql.includes("v_count * 5"), '5% per submission');
    assert.ok(sql.includes("progress_mode") && sql.includes("= 'auto'") || sql.includes("<> 'auto'"), 'auto-only');
    assert.ok(sql.includes('after insert or delete on public.project_timeline'), 'insert+delete trigger');
    assert.ok(sql.includes('manual_progress >= 0 and manual_progress <= 100'), 'override range');
    assert.ok(sql.includes('exception when others'), 'timeline writes never fail');
  });
});

describe('filters and sorting', () => {
  const a = { name: 'Alpha', status: 'in_progress', priority: 'high', end_date: '2026-09-28', visibility: 'private', manager_id: 'm1', description: 'Bridge works' };
  const b = { name: 'Beta', status: 'draft', priority: 'critical', end_date: null, visibility: 'public', description: '' };
  const c = { name: 'Gamma', status: 'Custom Review', priority: 'low', end_date: '2026-09-01', visibility: 'selected' };

  it('combines search + status + priority + visibility', () => {
    assert.equal(matchesProjectFilters(a, { search: 'bridge', status: 'in_progress', priority: 'high', visibility: 'private' }), true);
    assert.equal(matchesProjectFilters(a, { status: 'draft' }), false);
    assert.equal(matchesProjectFilters(c, { status: 'Custom Review' }), true);
    assert.equal(matchesProjectFilters(c, { status: 'draft' }), false);
  });

  it('deadline windows handle missing dates', () => {
    const now = new Date('2026-09-24T12:00:00');
    assert.equal(matchesProjectFilters(c, { deadline: 'overdue' }, now), true);
    assert.equal(matchesProjectFilters(b, { deadline: 'none' }, now), true);
    assert.equal(matchesProjectFilters(a, { deadline: 'none' }, now), false);
    assert.equal(matchesProjectFilters(a, { deadline: 'week' }, now), true);
    assert.equal(matchesProjectFilters(a, { deadline: 'today' }, now), false);
    assert.equal(matchesProjectFilters(a, { deadline: 'month' }, now), true);
  });

  it('sorts by priority critical > high > medium > low (not alphabetical)', () => {
    assert.ok(priorityRank('critical') < priorityRank('high'));
    assert.ok(priorityRank('high') < priorityRank('medium'));
    assert.ok(priorityRank('medium') < priorityRank('low'));
    const sorted = sortProjects([a, b, c], 'priority').map((p) => p.name);
    assert.deepEqual(sorted, ['Beta', 'Alpha', 'Gamma']);
  });

  it('sorts deadlines with missing dates last', () => {
    const sorted = sortProjects([b, a, c], 'deadline_asc').map((p) => p.name);
    assert.deepEqual(sorted, ['Gamma', 'Alpha', 'Beta']);
  });
});

describe('migration safety', () => {
  it('is additive, preserves data and existing RLS', () => {
    const sql = codeOf(read(MIG));
    assert.ok(sql.includes('add column if not exists priority'), 'priority column');
    assert.ok(sql.includes('add column if not exists visibility'), 'visibility column');
    assert.ok(sql.includes('add column if not exists progress_mode'), 'progress mode column');
    assert.ok(sql.includes('create table if not exists public.project_audience'), 'audience table');
    assert.ok(sql.includes('Users can read public projects'), 'public policy');
    assert.ok(sql.includes('Users can read selected-audience projects'), 'audience policy');
    assert.ok(!/drop policy if exists "Admins can read all projects"/i.test(sql), 'admin policy kept');
    assert.ok(!/supabase db reset|drop table public\.projects|truncate/i.test(sql), 'no destruction');
  });

  it('leaves the SMS migration alone', () => {
    const sms = read('supabase/migrations/20261001120000_event_reminders_sms.sql');
    assert.ok(!/project_audience|progress_mode|manual_progress/i.test(sms));
  });

  it('type definitions match the new columns', () => {
    const types = read('src/lib/database.types.ts');
    for (const col of ['priority:', 'visibility:', 'progress_mode:', 'manual_progress:', 'start_date:', 'project_audience:', 'submitted_by:']) {
      assert.ok(types.includes(col), `types include ${col}`);
    }
  });
});

describe('badges carry icon + label + dark-safe color', () => {
  it('priority mapping is green/yellow/orange/red with icons', () => {
    const src = read('src/components/shared/PriorityBadge.jsx');
    assert.ok(src.includes('ArrowDown') && src.includes('Minus') && src.includes('ArrowUp') && src.includes('AlertTriangle'));
    assert.ok(src.includes('emerald') && src.includes('yellow') && src.includes('orange-') && src.includes('red-'));
    assert.ok(src.includes('dark:'), 'dark-mode tokens');
    assert.ok(!/bg-slate-100|text-slate-600|bg-blue-50/.test(src), 'no legacy light-only classes');
  });

  it('status badge supports standard + custom statuses with icons', () => {
    const src = read('src/components/shared/StatusBadge.jsx');
    for (const icon of ['FileEdit', 'ClipboardList', 'PlayCircle', 'PauseCircle', 'CheckCircle2', 'Circle']) {
      assert.ok(src.includes(icon), `icon ${icon}`);
    }
    assert.ok(!/bg-slate-100|text-slate-800/.test(src), 'no hardcoded slate');
  });
});

describe('form and detail wiring', () => {
  it('form persists all fields, custom status, visibility and audience', () => {
    const src = read('src/components/projects/ProjectFormDialog.jsx');
    for (const field of ['type:', 'priority:', 'description:', 'start_date:', 'end_date:', 'location:', 'visibility:']) {
      assert.ok(src.includes(field), `payload includes ${field}`);
    }
    assert.ok(src.includes('__custom__') || src.includes('CUSTOM_STATUS_VALUE'), 'custom status flow');
    assert.ok(src.includes('VisibilitySelect') && src.includes('AudiencePicker'), 'shared selectors');
    assert.ok(src.includes("from('project_audience')"), 'audience sync');
    assert.ok(src.includes('write_audit_log'), 'canonical audit');
  });

  it('detail uses pending-save assignment, timeline removal and progress controls', () => {
    const src = read('src/pages/ProjectDetail.jsx');
    assert.ok(src.includes('pendingManagerId') && src.includes('managerTouched'), 'no accidental clear');
    assert.ok(src.includes('entryToDelete'), 'removal confirmation');
    assert.ok(!src.includes("from('documents').delete().eq('id', uploadedDocument.id)") || src.includes('orphaned record'), 'orphan cleanup kept');
    assert.ok(src.includes('progress_mode') && src.includes('manual_progress'), 'override model');
    assert.ok(src.includes('VisibilityBadge'), 'visibility in header');
    assert.ok(src.includes('+5%') || src.includes('+5'), 'contribution indicator');
  });

  it('documents can submit references to the timeline without duplication', () => {
    const src = read('src/pages/Documents.jsx');
    assert.ok(src.includes('submitToTimeline'), 'submit action');
    assert.ok(src.includes('document_id: doc.id'), 'reference, not copy');
    assert.ok(src.includes('23505'), 'duplicate guard');
  });
});
describe('project i18n coverage', () => {
  it('new keys exist in all four languages', () => {
    const i18n = read('src/i18n.js');
    for (const key of ['teamAssignmentSaved:', 'createCustomStatus:', 'timelineEntryRemoved:', 'removeFromTimeline:', 'submitToTimeline:', 'progress:', 'viewMode:', 'listView:', 'gridView:', 'sortBy:', 'clearFilters:', 'submittedBy:', 'errorsProjectSave:', 'errorsTimelineRemove:']) {
      const count = (i18n.match(new RegExp(`^\\s*${key}`, 'gm')) || []).length;
      assert.equal(count, 4, `${key} in 4 languages`);
    }
  });
});

describe('priority-colored progress bars', () => {
  it('central mapping covers all priorities with distinct colors', () => {
    assert.equal(getPriorityProgressClass('low'), PRIORITY_PROGRESS_CLASSES.low);
    assert.ok(PRIORITY_PROGRESS_CLASSES.low.includes('emerald'), 'low is green');
    assert.ok(PRIORITY_PROGRESS_CLASSES.medium.includes('yellow'), 'medium is yellow');
    assert.ok(PRIORITY_PROGRESS_CLASSES.high.includes('orange'), 'high is orange');
    assert.ok(PRIORITY_PROGRESS_CLASSES.critical.includes('red'), 'critical is red');
    assert.equal(getPriorityProgressClass('unknown'), 'bg-primary');
    assert.equal(getPriorityProgressClass(undefined), 'bg-primary');
  });

  it('cards, list rows and detail derive the fill from priority', () => {
    for (const f of ['src/components/projects/ProjectCard.jsx', 'src/pages/Projects.jsx', 'src/pages/ProjectDetail.jsx']) {
      const src = read(f);
      assert.ok(src.includes('indicatorClassName={getPriorityProgressClass('), `${f} uses central map`);
      assert.ok(!/indicatorClassName="bg-(red|green|emerald|yellow|orange)-500"/.test(src), `${f} has no hardcoded fill`);
    }
    const progress = read('src/components/ui/progress.jsx');
    assert.ok(progress.includes('indicatorClassName'), 'shared primitive supports it');
    assert.ok(progress.includes('bg-secondary'), 'neutral track');
  });
});

describe('archived projects sub-tab', () => {
  it('separates active/archived at the data-query level', () => {
    const src = read('src/pages/Projects.jsx');
    assert.ok(src.includes("filter: { status: 'archived' }"), 'archived query filtered');
    assert.ok(src.includes("exclude: { status: 'archived' }"), 'active query excludes');
    assert.ok(src.includes("queryKey: ['projects', projectTab]"), 'per-tab cache');
    const ds = read('src/services/dataService.js');
    assert.ok(ds.includes('.neq(key, value)'), 'exclude supported by listEntities');
  });

  it('uses accessible tabs with icons and translated labels', () => {
    const tabs = read('src/components/ui/tabs.jsx');
    assert.ok(tabs.includes('@radix-ui/react-tabs'), 'real tab implementation');
    assert.ok(tabs.includes('aria-selected') || tabs.includes('data-[state=active]'), 'active state exposed');
    const src = read('src/pages/Projects.jsx');
    assert.ok(src.includes('TabsList') && src.includes('TabsTrigger'), 'tabs used');
    assert.ok(src.includes('activeProjects') && src.includes('archivedProjects'), 'translated labels');
  });

  it('restore preserves exact prior state with audit trail', () => {
    const src = read('src/pages/ProjectDetail.jsx');
    assert.ok(src.includes('status_before_archive'), 'prior status tracked');
    assert.ok(src.includes('restoreMutation'), 'restore flow exists');
    assert.ok(src.includes('PROJECT_RESTORE') && src.includes('PROJECT_ARCHIVE'), 'audit events');
    assert.ok(src.includes('ArchiveRestore'), 'restore icon');
    const mig = codeOf(read('supabase/migrations/20261009120000_project_archive_status.sql'));
    assert.ok(mig.includes('add column if not exists status_before_archive'), 'additive column');
    assert.ok(!/drop table|truncate|db reset/i.test(mig), 'no destruction');
  });
});

describe('calendar upcoming cards', () => {
  it('shows the color visually without the color-name text', () => {
    const src = read('src/pages/CalendarPage.jsx');
    assert.ok(!src.includes('ms-1 text-[10px]'), 'no visible color-name span on cards');
    assert.ok(src.includes('role="img"'), 'indicator exposed to assistive tech');
    assert.ok(src.includes('aria-label={`${t('), 'accessible color label present');
    assert.ok(!/aria-label=\{`[^`]*#[0-9A-Fa-f]/.test(src), 'no raw HEX in labels');
    assert.ok(src.includes('{getEventLabel(ev.type)}'), 'event type still visible');
  });

  it('effective color precedence untouched', () => {
    const colors = read('src/lib/eventColors.js');
    assert.ok(colors.includes('event_color'), 'event override first');
    assert.ok(colors.includes('event_types') || colors.includes('eventType'), 'type color second');
    assert.ok(colors.includes('getAppAccentColor'), 'accent fallback third');
  });
});

describe('project visibility wording', () => {
  it('create-project uses project terminology; documents keep theirs', () => {
    const form = read('src/components/projects/ProjectFormDialog.jsx');
    assert.ok(form.includes('projectAudienceTitle') && form.includes('projectAudienceHelp'), 'project keys passed');
    const picker = read('src/components/documents/AudiencePicker.jsx');
    assert.ok(picker.includes('titleKey') && picker.includes('helpKey'), 'contextual labels supported');
    assert.ok(picker.includes("'Select audience'") || picker.includes('Select audience'), 'document default kept');
    const docs = read('src/pages/Documents.jsx');
    assert.ok(!docs.includes('projectAudienceTitle'), 'documents unchanged');
    const i18n = read('src/i18n.js');
    for (const key of ['projectAudienceTitle:', 'projectAudienceHelp:', 'archivedProjects:', 'restoreProject:', 'errorsProjectArchive:', 'errorsProjectRestore:', 'errorsVisibilitySave:']) {
      const count = (i18n.match(new RegExp(`^\\s*${key}`, 'gm')) || []).length;
      assert.equal(count, 4, `${key} in 4 languages`);
    }
  });
});
