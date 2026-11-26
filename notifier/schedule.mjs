// Which notification slot (if any) is due right now? Pure, so it can be tested.
//
// notify-schedule.json holds UK times. GitHub Actions runs in UTC, so we convert "now"
// to Europe/London with Intl (which knows about GMT/BST) and compare the local hour.

export const DEFAULT_TIME_ZONE = 'Europe/London';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Local date/hour/minute of `date` in `timeZone`. */
export function zonedParts(date, timeZone = DEFAULT_TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/**
 * Validate the schedule file. Shape:
 *   { "timeZone": "Europe/London", "quiz": ["10:00", "13:00"], "summary": "21:00" }
 * Returns { timeZone, slots: [{ type, time, hour }] } or throws a readable error.
 */
export function parseSchedule(json) {
  if (!json || typeof json !== 'object') throw new Error('notify-schedule.json must be a JSON object.');
  const timeZone = json.timeZone || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    throw new Error(`notify-schedule.json: unknown timeZone "${timeZone}".`);
  }
  const quiz = Array.isArray(json.quiz) ? json.quiz : [];
  const summary = json.summary ? [json.summary] : [];
  const slots = [];
  for (const [type, list] of [['quiz', quiz], ['summary', summary]]) {
    for (const time of list) {
      const m = TIME_RE.exec(String(time));
      if (!m) throw new Error(`notify-schedule.json: "${time}" isn't a time like "10:00".`);
      slots.push({ type, time, hour: Number(m[1]) });
    }
  }
  const hours = slots.map((s) => s.hour);
  const clash = hours.find((h, i) => hours.indexOf(h) !== i);
  if (clash !== undefined) {
    throw new Error(`notify-schedule.json: two notifications are set for the ${String(clash).padStart(2, '0')}:00 hour. The workflow runs once an hour, so keep them in different hours.`);
  }
  slots.sort((a, b) => a.hour - b.hour);
  return { timeZone, slots };
}

/**
 * The slot whose UK hour matches `now`, or null.
 * Slots are matched by hour because the workflow runs once an hour (at :17).
 * `key` is unique per local day and slot, so a second run in the same hour (or the
 * repeated hour when the clocks go back) can be spotted and skipped.
 */
export function findDueSlot(now, schedule) {
  const { date, hour, minute } = zonedParts(now, schedule.timeZone);
  const slot = schedule.slots.find((s) => s.hour === hour);
  if (!slot) return null;
  return {
    type: slot.type,
    time: slot.time,
    key: `notify-${date}T${String(slot.hour).padStart(2, '0')}-${slot.type}`,
    local: `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/** Human summary like "Quiz at 10:00, 13:00 · Summary at 21:00 (UK time)". */
export function describeSchedule(schedule) {
  const quiz = schedule.slots.filter((s) => s.type === 'quiz').map((s) => s.time);
  const summary = schedule.slots.filter((s) => s.type === 'summary').map((s) => s.time);
  const parts = [];
  if (quiz.length) parts.push(`Quiz at ${quiz.join(', ')}`);
  if (summary.length) parts.push(`Summary at ${summary.join(', ')}`);
  return `${parts.join(' · ') || 'No notifications'} (${schedule.timeZone})`;
}
