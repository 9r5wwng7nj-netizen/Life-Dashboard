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

test('one entry can add several tasks, dated from the first with + and −', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => { ui.taskTab = 'today'; go('tasks'); });
  const entry = 'Meeting with Zach 12/20 at 3:30pm ~Zach #work | Text Zach to confirm today | Bring the handout -1 | Follow up on next steps +1 at 9am | Check in on progress +1w | Send the recap 12/24 #home | Think about a gift';
  await page.fill('#nl-in', entry);
  const preview = page.locator('#nl-prev');
  await expect(preview).toContainText('7 tasks');
  await expect(preview).toContainText('No date · goes to the Inbox');
  await page.click('form[data-submit="taskAdd"] button.btn-primary');

  const year = await page.evaluate(() => { const now = new Date(), d = new Date(now.getFullYear(), 11, 20); return ymd(d) < ymd() ? now.getFullYear() + 1 : now.getFullYear(); });
  const tasks = await page.evaluate(() => TK().map(t => ({ title: t.title, due: t.due, time: t.time || null, person: t.person || null, tags: t.tags, inbox: isInbox(t) })));
  expect(tasks).toEqual([
    { title: 'Meeting with Zach', due: `${year}-12-20`, time: '15:30', person: 'Zach', tags: ['work'], inbox: false },
    { title: 'Text Zach to confirm', due: await page.evaluate(() => ymd()), time: null, person: 'Zach', tags: ['work'], inbox: false },
    { title: 'Bring the handout', due: `${year}-12-19`, time: null, person: 'Zach', tags: ['work'], inbox: false },
    { title: 'Follow up on next steps', due: `${year}-12-21`, time: '09:00', person: 'Zach', tags: ['work'], inbox: false },
    { title: 'Check in on progress', due: `${year}-12-27`, time: null, person: 'Zach', tags: ['work'], inbox: false },
    { title: 'Send the recap', due: `${year}-12-24`, time: null, person: 'Zach', tags: ['home'], inbox: false },
    { title: 'Think about a gift', due: null, time: null, person: 'Zach', tags: ['work'], inbox: true },
  ]);

  // A single task is unaffected: + and − are plain text there, and nothing is split.
  expect(await page.evaluate(() => [parseTaskBlocks('Buy milk tomorrow'), parseTaskInput('Score was +3 over par').title, parseTaskInput('Review -2 variance').title])).toEqual([null, 'Score was +3 over par', 'Review -2 variance']);
  // With no date on the first task, offsets count from today.
  expect(await page.evaluate(() => parseTaskBlocks('Start the project | First review +2').map(p => p.due && daysBetween(ymd(), p.due)))).toEqual([null, 2]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the Repeat box beside Add makes every task in the entry repeat', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => { ui.taskTab = 'today'; go('tasks'); });
  const form = page.locator('form[data-submit="taskAdd"]'), preview = page.locator('#nl-prev');
  await expect(page.locator('#add-rep')).toBeHidden();

  // Ticking it keeps what was typed and shows the choices.
  await page.fill('#nl-in', 'Water the plants | Take out the trash +1 | Stretch every weekday');
  await form.getByLabel('Repeat', { exact: true }).check();
  await expect(page.locator('#nl-in')).toHaveValue('Water the plants | Take out the trash +1 | Stretch every weekday');
  await expect(page.locator('#add-rep')).toBeVisible();
  await expect(page.locator('#add-rep-custom')).toBeHidden();
  await expect(preview).toContainText('weekly');
  await form.locator('button.btn-primary').click();
  let tasks = await page.evaluate(() => TK().map(t => [t.title, t.repeat, daysBetween(ymd(), t.due)]));
  expect(tasks[0]).toEqual(['Water the plants', { freq: 'week', n: 1 }, 0]); // no date given, so it starts today
  expect(tasks[1]).toEqual(['Take out the trash', { freq: 'week', n: 1 }, 1]);
  expect(tasks[2][1]).toEqual({ freq: 'weekday', n: 1 }); // its own repeat wins
  // The box clears after adding, so the next task does not repeat by accident.
  await expect(form.getByLabel('Repeat', { exact: true })).not.toBeChecked();
  await page.fill('#nl-in', 'One-off errand tomorrow');
  await form.locator('button.btn-primary').click();
  expect(await page.evaluate(() => TK().at(-1).repeat)).toBeUndefined();

  // Custom: every 3 days.
  await page.fill('#nl-in', 'Refill the feeder');
  await form.getByLabel('Repeat', { exact: true }).check();
  await form.locator('select[name="repKind"]').selectOption('custom');
  await expect(page.locator('#add-rep-custom')).toBeVisible();
  await form.locator('input[name="repN"]').fill('3');
  await form.locator('select[name="repUnit"]').selectOption('day');
  await expect(preview).toContainText('every 3 days');
  await form.locator('button.btn-primary').click();
  const feeder = await page.evaluate(() => { const t = TK().at(-1); return { id: t.id, repeat: t.repeat }; });
  expect(feeder.repeat).toEqual({ freq: 'day', n: 3 });

  // Opening and saving that task keeps the custom interval, and completing it schedules three days on.
  await page.evaluate(id => taskModal(tFind(id)), feeder.id);
  await expect(page.locator('#modal select[name="repeat"]')).toHaveValue('day:3');
  await page.click('#modal button:has-text("Save")');
  expect(await page.evaluate(id => tFind(id).repeat, feeder.id)).toEqual({ freq: 'day', n: 3 });
  expect(await page.evaluate(id => { setTaskStatus(tFind(id), 'done'); return daysBetween(ymd(), TK().at(-1).due); }, feeder.id)).toBe(3);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the rules for adding tasks can be shown under the box and stay shown', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { ui.taskTab = 'today'; go('tasks'); });
  const rules = page.locator('#task-rules');
  await expect(rules).toBeHidden();
  await page.fill('#nl-in', 'Half-typed task');
  await page.getByRole('button', { name: 'Show the rules for adding tasks' }).click();
  await expect(rules).toBeVisible();
  await expect(rules).toContainText('starts a new task');
  await expect(rules).toContainText('is the day after the first task');
  await expect(rules).toContainText('A task with no date goes to the Inbox');
  await expect(page.locator('#nl-in')).toHaveValue('Half-typed task');
  await page.reload();
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Array.isArray(Store.data.tasks));
  await page.evaluate(() => { ui.taskTab = 'today'; go('tasks'); });
  await expect(page.locator('#task-rules')).toBeVisible();
  await page.getByRole('button', { name: 'Hide the rules for adding tasks' }).click();
  await expect(page.locator('#task-rules')).toBeHidden();
});

test('a repeat can be set for chosen days of the week', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => { ui.taskTab = 'today'; go('tasks'); });
  const form = page.locator('form[data-submit="taskAdd"]');
  await page.fill('#nl-in', 'Go for a run');
  await form.getByLabel('Repeat', { exact: true }).check();
  await form.locator('select[name="repKind"]').selectOption('days');
  await expect(page.locator('#add-rep-days')).toBeVisible();

  // With no day ticked, nothing is added and the entry is kept.
  await form.locator('button.btn-primary').click();
  expect(await page.evaluate(() => TK().length)).toBe(0);
  await expect(page.locator('#nl-in')).toHaveValue('Go for a run');

  for (const day of ['Mon', 'Thu', 'Sat']) await page.locator('#add-rep-days').getByLabel(day).check();
  await expect(page.locator('#nl-prev')).toContainText('Mon, Thu & Sat');
  await form.locator('button.btn-primary').click();
  const made = await page.evaluate(() => { const t = TK()[0]; return { id: t.id, repeat: t.repeat, weekday: parseYmd(t.due).getDay(), ahead: daysBetween(ymd(), t.due) }; });
  expect(made.repeat).toEqual({ freq: 'days', n: 1, days: [1, 4, 6] });
  expect([1, 4, 6]).toContain(made.weekday); // starts on the first chosen day, today included
  expect(made.ahead).toBeGreaterThanOrEqual(0);
  expect(made.ahead).toBeLessThanOrEqual(2);

  // A time or date that lands between chosen days still starts on a chosen day.
  expect(await page.evaluate(() => ['Early run at 6am', 'Late run at 11:59pm', 'Dated run 2030-01-01'].map(x => parseYmd(applyRepeat(parseTaskInput(x.replace('2030-01-01', '@2030-01-01')), { freq: 'days', n: 1, days: [1, 4, 6] }).due).getDay()).every(d => [1, 4, 6].includes(d)))).toBe(true);
  // Each completion moves to the next chosen day: Mon → Thu → Sat → Mon.
  expect(await page.evaluate(() => ['2026-10-12', '2026-10-15', '2026-10-17'].map(d => nextDue({ freq: 'days', days: [1, 4, 6] }, d)))).toEqual(['2026-10-15', '2026-10-17', '2026-10-19']);
  expect(await page.evaluate(() => [repeatLabel({ freq: 'days', days: [6, 1, 4] }), repeatLabel({ freq: 'days', days: [1, 2, 3, 4, 5] }), repeatLabel({ freq: 'days', days: [0] })])).toEqual(['Mon, Thu & Sat', 'weekdays', 'Sun']);

  // The task editor shows the days ticked, and they can be changed there.
  await page.evaluate(id => taskModal(tFind(id)), made.id);
  const days = page.locator('#task-rep-days');
  await expect(page.locator('#modal select[name="repeat"]')).toHaveValue('days');
  await expect(days).toBeVisible();
  for (const [day, on] of [['Mon', true], ['Tue', false], ['Thu', true], ['Sat', true], ['Sun', false]]) on ? await expect(days.getByLabel(day)).toBeChecked() : await expect(days.getByLabel(day)).not.toBeChecked();
  await days.getByLabel('Thu').uncheck();
  await days.getByLabel('Sun').check();
  await page.click('#modal button:has-text("Save")');
  expect(await page.evaluate(id => tFind(id).repeat, made.id)).toEqual({ freq: 'days', n: 1, days: [1, 6, 0] });

  // Switching the dropdown hides or shows the days; saving with none ticked is refused and nothing changes.
  await page.evaluate(id => taskModal(tFind(id)), made.id);
  await page.selectOption('#modal select[name="repeat"]', 'week');
  await expect(days).toBeHidden();
  await page.selectOption('#modal select[name="repeat"]', 'days');
  await expect(days).toBeVisible();
  for (const day of ['Mon', 'Sat', 'Sun']) await days.getByLabel(day).uncheck();
  await page.click('#modal button:has-text("Save")');
  await expect(page.locator('#modal')).toBeVisible();
  expect(await page.evaluate(id => tFind(id).repeat, made.id)).toEqual({ freq: 'days', n: 1, days: [1, 6, 0] });
  await page.keyboard.press('Escape');

  // A task that repeats another way can be switched to certain days.
  await page.evaluate(() => { const t = addTask('Team sync weekly'); taskModal(t); });
  await page.selectOption('#modal select[name="repeat"]', 'days');
  await days.getByLabel('Wed').check();
  await page.click('#modal button:has-text("Save")');
  expect(await page.evaluate(() => TK().at(-1).repeat)).toEqual({ freq: 'days', n: 1, days: [3] });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('text in parentheses goes to the notes, not the title', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => { ui.taskTab = 'today'; go('tasks'); });
  const parsed = await page.evaluate(() => [
    'Call the plumber fri (ask about the water heater and get a quote)',
    'Plan the trip (check tomorrow’s forecast #home ~Sam) next week',
    'Email Dana (budget) and Lee (timeline) today',
    '(just a thought)',
    'Smile :) and wave',
    'Odd one (never closed',
  ].map(x => { const p = parseTaskInput(x); return [p.title, p.notes, !!p.due, p.tags, p.person]; }));
  expect(parsed[0]).toEqual(['Call the plumber', 'ask about the water heater and get a quote', true, [], null]);
  // Nothing inside a note is read as a date, tag or person.
  expect(parsed[1]).toEqual(['Plan the trip', 'check tomorrow’s forecast #home ~Sam', true, [], null]);
  expect(parsed[2].slice(0, 2)).toEqual(['Email Dana and Lee', 'budget\ntimeline']);
  expect(parsed[3].slice(0, 2)).toEqual(['', 'just a thought']);
  expect(parsed[4].slice(0, 2)).toEqual(['Smile :) and wave', '']);
  expect(parsed[5].slice(0, 2)).toEqual(['Odd one (never closed', '']);

  // In the box: the preview shows the note, each task of a | entry keeps its own, and a bar inside a note does not split.
  await page.fill('#nl-in', 'Meet Sam 12/20 at 2pm (bring the contract | and a pen) ~Sam | Send the recap +1 (include action items) | Book a room -2');
  const preview = page.locator('#nl-prev');
  await expect(preview).toContainText('3 tasks');
  await expect(preview).toContainText('📝 bring the contract | and a pen');
  await page.click('form[data-submit="taskAdd"] button.btn-primary');
  expect(await page.evaluate(() => TK().map(t => [t.title, t.notes]))).toEqual([['Meet Sam', 'bring the contract | and a pen'], ['Send the recap', 'include action items'], ['Book a room', '']]);

  // An entry that is only a note adds nothing.
  await page.fill('#nl-in', '(only a note)');
  await page.click('form[data-submit="taskAdd"] button.btn-primary');
  expect(await page.evaluate(() => TK().length)).toBe(3);

  // The note shows in the editor's Notes field.
  await page.evaluate(() => taskModal(TK()[0]));
  await expect(page.locator('#modal textarea[name="notes"]')).toHaveValue('bring the contract | and a pen');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a task on today’s list can be pushed 1, 2 or 3 days', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(tasks => { Store.set('tasks', tasks); ui.taskTab = 'today'; go('tasks'); }, [task('due today', { due: new Date().toLocaleDateString('en-CA') }), task('overdue', { due: '2020-01-01' }), task('next week', { due: '2099-01-01' })]);
  const push = (id, n) => page.locator(`[data-action="taskPush"][data-id="${id}"][data-n="${n}"]`);
  await expect(push('due today', 1)).toBeVisible();
  await expect(push('overdue', 3)).toBeVisible();
  await expect(page.locator('[data-action="taskPush"][data-id="next week"]')).toHaveCount(0);

  await push('due today', 2).click();
  await push('overdue', 1).click();
  expect(await page.evaluate(() => TK().slice(0, 2).map(t => [daysBetween(ymd(), t.due), t.pushed || 0]))).toEqual([[2, 1], [1, 1]]);
  // Pushed tasks leave today's list.
  await expect(page.locator('[data-action="taskPush"]')).toHaveCount(0);
  // Select mode hides the buttons.
  await page.evaluate(() => { TK()[0].due = ymd(); render(); });
  await expect(push('due today', 1)).toBeVisible();
  await page.click('[data-action="selToggle"]');
  await expect(page.locator('[data-action="taskPush"]')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Tidy up walks through tasks 3+ days overdue once a day: today, someday, done or delete', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => { const ago = n => addDays(ymd(), -n), t = (id, due) => ({ id, title: id, notes: '', status: 'todo', priority: 'med', tags: [], area: 'home', created: new Date().toISOString(), due }); Store.set('tasks', [t('ten-days', ago(10)), t('five-days', ago(5)), t('four-days', ago(4)), t('three-days', ago(3)), t('yesterday', ago(1))]); ui.taskTab = 'today'; go('tasks'); });
  await expect(page.locator('#view')).toContainText('4 tasks have waited 3 days or more.');
  await page.click('#view [data-action="sweepStart"]');
  await expect(page.locator('#modal')).toContainText('Tidy up · 1 of 4');
  await expect(page.locator('#modal')).toContainText('ten-days');
  await page.click('#modal [data-action="sweepDo"][data-v="today"]');
  await expect(page.locator('#modal')).toContainText('five-days');
  await page.click('#modal [data-action="sweepDo"][data-v="someday"]');
  await page.click('#modal [data-action="sweepDo"][data-v="done"]');
  await expect(page.locator('#modal')).toContainText('three-days');
  await page.click('#modal [data-action="sweepDo"][data-v="delete"]');
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#toasts')).toContainText('Tidied 4 tasks');
  const r = await page.evaluate(() => ({ tasks: Object.fromEntries(TK().map(t => [t.id, [t.status, t.due === ymd() ? 'today' : t.due ? 'other' : null, !!t.someday]])), swept: tkit().swept === ymd() }));
  expect(r.tasks).toEqual({ 'ten-days': ['todo', 'today', false], 'five-days': ['todo', null, true], 'four-days': ['done', 'other', false], yesterday: ['todo', 'other', false] });
  expect(r.swept).toBe(true);
  await expect(page.locator('#view [data-action="sweepStart"]')).toHaveCount(0);

  // Not today hides the offer until tomorrow; it comes back on a new day.
  await page.evaluate(() => { delete tkit().swept; TK().find(t => t.id === 'yesterday').due = addDays(ymd(), -6); render(); });
  await page.click('#view [data-action="sweepLater"]');
  await expect(page.locator('#view [data-action="sweepStart"]')).toHaveCount(0);
  await page.evaluate(() => { tkit().swept = addDays(ymd(), -1); render(); });
  await expect(page.locator('#view [data-action="sweepStart"]')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('on a phone a task row puts push, Today and the star on one line under a full-width title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await open(page);
  await page.evaluate(() => { Store.set('tasks', [{ id: 'late', title: 'Call Sam about Sunday', status: 'todo', priority: 'med', area: 'ministry', due: addDays(ymd(), -1), created: new Date().toISOString() }]); ui.taskTab = 'today'; go('tasks'); });
  const row = page.locator('#view [data-drag-task], #view .rounded-xl.border').filter({ hasText: 'Call Sam about Sunday' }).first();
  await expect(row.locator('[data-action="taskPush"]')).toHaveCount(3);
  await expect(row.locator('[data-action="blkNew"], [data-action="ftStartA"]')).toHaveCount(0);
  const [title, push, today] = await Promise.all([row.locator('[data-action="taskEdit"]').boundingBox(), row.locator('[data-action="taskPush"][data-n="1"]').boundingBox(), row.locator('[data-action="tdSet"]').boundingBox()]);
  expect(Math.abs(push.y - today.y)).toBeLessThan(4); // same line
  expect(push.y).toBeGreaterThan(title.y); // under the title
  expect((await row.boundingBox()).height).toBeLessThan(140);
  // A wide screen keeps the usual layout with every button.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => render());
  await expect(page.locator('#view [data-action="ftStartA"]')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the Weekly reset adds last week, the family review and the Obsidian review to planning, and Today offers it on Sunday', async ({ page }) => {
  const { errors } = await open(page);
  await page.evaluate(() => {
    const mon = weekKeyT(), last = addDays(mon, -7);
    Store.set('tasks', [{ id: 'f1', title: 'Finished', status: 'done', completedAt: last + 'T10:00:00', created: last, area: 'home' }]);
    Store.set('workouts', [{ id: 'w1', name: 'Push', start: addDays(last, 1) + 'T07:00:00', end: addDays(last, 1) + 'T08:00:00', exercises: [] }]); sortWorkouts();
    Store.set('fpeople', [{ id: 'p1', name: 'Sam', role: 'spouse' }]);
    window.LD_OBSIDIAN = { vault: 'V', notes: [], people: [], prefix: '#ld-obsidian=' };
    ui.taskTab = 'plan'; go('tasks');
  });
  await expect(page.locator('#view [data-action="setTab"][data-val="plan"]')).toContainText('Weekly reset');
  const view = page.locator('#view');
  await expect(view).toContainText('How last week went');
  const lastWeek = view.locator('.card').filter({ has: page.locator('h3', { hasText: /^How last week went$/ }) });
  await expect(lastWeek).toContainText('Workouts1');
  await expect(lastWeek).toContainText('Tasks finished1');
  await expect(view).toContainText('Start the review');
  // Steps number themselves (a ticked step keeps its number's place); no nutrition plan, no nutrition step.
  expect(await view.locator('.card .rounded-full.grid').allInnerTexts()).toEqual(['1', '✓', '✓', '4', '5', '6', '7', '8']);
  expect(await view.locator('.card h3').allInnerTexts()).toEqual(['How last week went', 'Clear the decks', 'Empty the inbox', 'Family review', 'Pick your Big 3', 'Look at the week', 'Focus for the week', 'Weekly review in Obsidian']);
  await page.click('#view [data-action="obsWeekly"]');
  expect(await page.evaluate(() => decodeURIComponent(location.hash))).toContain('"openWeekly":true');
  expect(await page.evaluate(() => !!weekRec(weekKeyT()).obsReview)).toBe(true);

  // On a Sunday the Today card offers the reset for the week ahead.
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); window.__getDay = Date.prototype.getDay; Date.prototype.getDay = function () { return 0; }; go('dashboard'); });
  const offer = page.locator('#view [data-action="goWeekReset"]');
  await expect(offer).toContainText('Get ready for the week ahead');
  expect(await offer.getAttribute('data-wk')).toBe(await page.evaluate(() => addDays(weekKeyT(), 7)));
  await offer.click();
  expect(await page.evaluate(() => [S.view, ui.taskTab, ui.planWk === addDays(weekKeyT(), 7)])).toEqual(['tasks', 'plan', true]);
  await page.evaluate(() => { weekRec(addDays(weekKeyT(), 7)).planned = ymd(); go('dashboard'); });
  await expect(page.locator('#view [data-action="goWeekReset"]')).toHaveCount(0);
  await page.evaluate(() => { Date.prototype.getDay = window.__getDay; });
  expect(errors, errors.join('\n')).toEqual([]);
});
