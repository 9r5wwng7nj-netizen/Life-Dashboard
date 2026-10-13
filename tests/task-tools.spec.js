// Repeating projects and changing many tasks at once.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = pathToFileURL(path.resolve('index.html')).href;
async function open(page, answer = () => true) {
  const errors = [], asked = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', d => { asked.push(d.message()); return answer() ? d.accept() : d.dismiss(); });
  await page.goto(APP);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => A.helpDismiss({ dataset: { what: 'tour' } }));
  return { errors, asked };
}
const task = (id, extra) => ({ id, title: id, notes: '', status: 'todo', priority: 'med', tags: [], area: 'home', created: new Date().toISOString(), ...extra });

test('a repeating project makes its next round with every task moved forward', async ({ page }) => {
  const { errors } = await open(page);
  const made = await page.evaluate(([a, b, c]) => {
    const due = addDays(ymd(), 3), label = d => fmtDate(d, { month: 'short', day: 'numeric' });
    Store.set('projects', [{ id: 'grp', name: `Small group week · ${label(due)}`, area: 'ministry', due, status: 'active', notes: '', created: new Date().toISOString() }]);
    Store.set('tasks', [{ ...a, project: 'grp', due: addDays(due, -5) < ymd() ? ymd() : addDays(due, -2) }, { ...b, project: 'grp', due, subtasks: [{ id: 's', text: 'Step', done: true }] }, { ...c, project: 'grp', due: addDays(due, 1) }]);
    ui.taskTab = 'projects'; ui.projOpen = 'grp'; go('tasks');
    return { due, next: addDays(due, 7), label: label(addDays(due, 7)) };
  }, [task('Send reminder'), task('Lead the group'), task('Follow up')]);

  // Nothing happens until Repeat is switched on, and nothing yet while the round is still ahead.
  await page.selectOption('[data-change="projRepeat"]', 'week');
  expect(await page.evaluate(() => Store.get('projects').length)).toBe(1);
  await expect(page.locator('#view')).toContainText('The next round appears on the due date');

  // Finishing every task completes this round and creates the next one.
  await page.evaluate(() => { TK().forEach(t => setTaskStatus(t, 'done')); Store.save('tasks'); render(); });
  const after = await page.evaluate(() => ({ projects: Store.get('projects').map(p => [p.id, p.name, p.due, p.status, !!p.repeat]), next: TK().filter(t => t.project !== 'grp').map(t => [t.title, t.due, t.status, (t.subtasks || []).map(s => s.done)]), old: TK().filter(t => t.project === 'grp').map(t => t.status) }));
  expect(after.projects).toEqual([['grp', expect.any(String), made.due, 'done', true], [`grp.r${made.next}`, `Small group week · ${made.label}`, made.next, 'active', true]]);
  expect(after.old).toEqual(['done', 'done', 'done']);
  expect(after.next.map(t => t[0])).toEqual(['Send reminder', 'Lead the group', 'Follow up']);
  expect(after.next[1]).toEqual(['Lead the group', made.next, 'todo', [false]]);
  expect(await page.evaluate(([n, t]) => daysBetween(n, t), [made.next, after.next[2][1]])).toBe(1);

  // Rendering again never makes a second copy, and the same ids mean two devices would agree.
  await page.evaluate(() => { render(); render(); });
  expect(await page.evaluate(() => [Store.get('projects').length, TK().length])).toEqual([2, 6]);
  expect(await page.evaluate(n => TK().filter(t => t.project === `grp.r${n}`).map(t => t.id), made.next)).toEqual([`Send reminder.r${made.next}`, `Lead the group.r${made.next}`, `Follow up.r${made.next}`].map(x => x));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a repeating project whose date has arrived makes the next round even if tasks are unfinished', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(([a, b]) => {
    const due = addDays(ymd(), -15);
    Store.set('projects', [{ id: 'm', name: 'Monthly money review', area: 'personal', due, status: 'active', repeat: { freq: 'week', n: 1 }, created: new Date().toISOString() }]);
    Store.set('tasks', [{ ...a, project: 'm', due: addDays(due, -1), status: 'done' }, { ...b, project: 'm', due }]);
    render();
    const ps = Store.get('projects'), next = ps[1];
    return { count: ps.length, old: ps[0].status, nextDue: next.due, ahead: daysBetween(ymd(), next.due), taskDues: TK().filter(t => t.project === next.id).map(t => daysBetween(ymd(), t.due)), name: next.name };
  }, [task('Open statements'), task('Review spending')]);
  expect(r.count).toBe(2);
  expect(r.old).toBe('active'); // the unfinished round stays open
  expect(r.ahead).toBeGreaterThanOrEqual(0); // missed rounds are skipped, not piled up
  expect(r.ahead).toBeLessThan(7);
  expect(r.taskDues.every(d => d >= 0)).toBe(true);
  expect(r.name).toBe('Monthly money review');
});

test('using a template can start a repeating project', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { ui.taskTab = 'templates'; go('tasks'); });
  await page.click('[data-action="libUse"][data-key="group"]');
  await page.fill('#modal input[name="date"]', '2030-06-12');
  await page.selectOption('#modal select[name="repeat"]', 'week');
  await page.click('#modal button:has-text("Add tasks")');
  expect(await page.evaluate(() => Store.get('projects').map(p => [p.name, p.due, p.repeat]))).toEqual([['Small group week · Jun 12', '2030-06-12', { freq: 'week', n: 1 }]]);
});

test('several tasks can be selected and changed together', async ({ page }) => {
  let allow = false;
  const { errors, asked } = await open(page, () => allow);
  await page.evaluate(tasks => { Store.set('tasks', tasks); ui.taskTab = 'all'; ui.taskView = 'list'; go('tasks'); }, [task('one', { due: '2030-01-01' }), task('two', { due: '2030-01-02' }), task('three', { due: '2030-01-03' }), task('four', { due: '2030-01-04' })]);
  const statuses = () => page.evaluate(() => Object.fromEntries(TK().map(t => [t.id, t.status])));

  await expect(page.locator('[data-sel]')).toHaveCount(0);
  await page.click('[data-action="selToggle"]');
  await expect(page.locator('[data-sel]')).toHaveCount(4);
  await expect(page.locator('[data-action="selApply"][data-do="delete"]')).toBeDisabled();

  // Ticking a box selects; it does not complete the task. Tapping the title selects too.
  await page.check('[data-sel="one"]');
  await page.click('#view button[data-action="taskEdit"][data-id="two"]');
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.getByRole('region', { name: 'Change selected tasks' })).toContainText('2 selected');
  expect(await statuses()).toEqual({ one: 'todo', two: 'todo', three: 'todo', four: 'todo' });

  await page.click('[data-action="selApply"][data-do="status:doing"]');
  expect(await statuses()).toEqual({ one: 'doing', two: 'doing', three: 'todo', four: 'todo' });
  // Still on screen, so still selected for a second change.
  await expect(page.getByRole('region', { name: 'Change selected tasks' })).toContainText('2 selected');
  await page.selectOption('select[data-do="area"]', 'personal');
  expect(await page.evaluate(() => TK().map(t => t.area))).toEqual(['personal', 'personal', 'home', 'home']);

  // Delete asks first; declining keeps everything.
  await page.click('[data-action="selAll"]');
  await expect(page.getByRole('region', { name: 'Change selected tasks' })).toContainText('4 selected');
  await page.uncheck('[data-sel="four"]');
  await page.click('[data-action="selApply"][data-do="delete"]');
  expect(asked).toEqual(['Delete 3 tasks? This cannot be undone.']);
  expect(await page.evaluate(() => TK().length)).toBe(4);
  allow = true;
  await page.click('[data-action="selApply"][data-do="delete"]');
  expect(await page.evaluate(() => TK().map(t => t.id))).toEqual(['four']);
  await expect(page.getByRole('region', { name: 'Change selected tasks' })).toContainText('0 selected');

  // Finishing returns the tick boxes to completing tasks.
  await page.click('[data-action="selToggle"]');
  await expect(page.locator('[data-sel]')).toHaveCount(0);
  await page.check('#view [data-change="taskToggle"][data-id="four"]');
  expect(await statuses()).toEqual({ four: 'done' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('select mode works in the Inbox and ends when leaving Tasks', async ({ page }) => {
  await open(page);
  await page.evaluate(tasks => { Store.set('tasks', tasks); ui.taskTab = 'inbox'; go('tasks'); }, [task('a', { area: null }), task('b', { area: null }), task('c', { area: null })]);
  await page.click('[data-action="selToggle"]');
  await page.click('[data-action="selAll"]');
  await page.click('[data-action="selApply"][data-do="due:today"]');
  await expect(page.getByRole('region', { name: 'Change selected tasks' })).toContainText('3 selected'); // dated, but still need an area
  await page.selectOption('select[data-do="area"]', 'home');
  expect(await page.evaluate(() => TK().filter(isInbox).length)).toBe(0);
  await expect(page.getByRole('region', { name: 'Change selected tasks' })).toContainText('0 selected');
  await page.evaluate(() => go('dashboard'));
  expect(await page.evaluate(() => ui.taskSel)).toBeNull();
});
