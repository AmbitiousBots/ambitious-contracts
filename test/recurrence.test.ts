import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import { addDays, firstDue, isCalendarDate, nextDue, parseRecurrence } from "../src/domain/recurrence.ts";
import { isInstant } from "../src/domain/types.ts";

const anchor = "2026-01-01";

function sequence(value: string, count: number, start = anchor): readonly string[] {
  const rule = parseRecurrence(value, start);
  const dates: string[] = [];
  let current: string | null = firstDue(rule);
  while (current !== null && dates.length < count) {
    dates.push(current);
    current = nextDue(rule, current);
  }
  return dates;
}

test("one-time work has one due date", () => {
  assert.deepEqual(sequence("once:2026-12-31", 3), ["2026-12-31"]);
});

test("monthly schedules retain their original day after short months", () => {
  assert.deepEqual(sequence("every:1month@2024-01-31", 5), [
    "2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31",
  ]);
  assert.deepEqual(sequence("every:1month@2025-01-30", 4), [
    "2025-01-30", "2025-02-28", "2025-03-30", "2025-04-30",
  ]);
});

test("yearly schedules retain leap-day anchors across century boundaries", () => {
  assert.deepEqual(sequence("every:1year@2096-02-29", 9), [
    "2096-02-29", "2097-02-28", "2098-02-28", "2099-02-28", "2100-02-28",
    "2101-02-28", "2102-02-28", "2103-02-28", "2104-02-29",
  ]);
});

test("weekly intervals cross calendar years using UTC dates", () => {
  assert.deepEqual(sequence("every:2week@2025-12-26", 3), ["2025-12-26", "2026-01-09", "2026-01-23"]);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-03-01", -1), "2024-02-29");
});

test("RFC monthly rules omit invalid dates instead of moving them", () => {
  assert.deepEqual(sequence("rrule:FREQ=MONTHLY;BYMONTHDAY=31", 5, "2024-01-01"), [
    "2024-01-31", "2024-03-31", "2024-05-31", "2024-07-31", "2024-08-31",
  ]);
  assert.deepEqual(sequence("rrule:FREQ=MONTHLY", 4, "2024-01-31"), [
    "2024-01-31", "2024-03-31", "2024-05-31", "2024-07-31",
  ]);
  assert.deepEqual(sequence("rrule:FREQ=MONTHLY;BYMONTHDAY=-1", 4, "2024-01-15"), [
    "2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30",
  ]);
});

test("RFC intervals keep the start month even when its requested date has passed", () => {
  assert.deepEqual(sequence("rrule:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15", 3, "2026-01-20"), [
    "2026-03-15", "2026-05-15", "2026-07-15",
  ]);
  assert.deepEqual(sequence("rrule:FREQ=DAILY;INTERVAL=2", 3, "2026-12-30"), [
    "2026-12-30", "2027-01-01", "2027-01-03",
  ]);
  assert.deepEqual(sequence("rrule:FREQ=WEEKLY;INTERVAL=2", 3, "2026-12-30"), [
    "2026-12-30", "2027-01-13", "2027-01-27",
  ]);
  assert.deepEqual(sequence("rrule:FREQ=YEARLY", 3, "2096-02-29"), [
    "2096-02-29", "2104-02-29", "2108-02-29",
  ]);
});

test("unsupported recurrence syntax and impossible dates are rejected", () => {
  for (const value of [
    "once:2026-02-29", "once:0000-01-01", "once:2026-01-01T00:00:00Z", "every:0day", "every:-1month",
    "every:1.5day", "every:01day", "every:1days", "every:1year@2025-02-29", "every:9007199254740992day",
    "rrule:FREQ=HOURLY", "rrule:INTERVAL=1", "rrule:FREQ=MONTHLY;COUNT=3", "rrule:FREQ=MONTHLY;BYMONTHDAY=0",
    "rrule:FREQ=MONTHLY;BYMONTHDAY=32", "rrule:FREQ=MONTHLY;BYMONTHDAY=-32", "rrule:FREQ=MONTHLY;BYMONTHDAY=1,15",
    "rrule:FREQ=WEEKLY;BYMONTHDAY=2", "rrule:FREQ=MONTHLY;FREQ=DAILY", "rrule:FREQ=DAILY;INTERVAL=0",
    "rrule:FREQ=DAILY;", "rrule:FREQ=DAILY;INTERVAL=1=2",
  ]) assert.throws(() => parseRecurrence(value, anchor), Error, value);
  assert.equal(isCalendarDate("1900-02-29"), false);
  assert.equal(isCalendarDate("2000-02-29"), true);
  assert.equal(isCalendarDate("0001-01-01"), true);
  assert.equal(isCalendarDate("9999-12-31"), true);
  assert.throws(() => addDays("9999-12-31", 1));
  assert.throws(() => addDays("0001-01-01", -1));
  assert.throws(() => addDays(anchor, 0.5));
  assert.throws(() => nextDue(parseRecurrence("every:1month", anchor), "not a date"));
});

test("generated monthly schedules emit exactly one anchored date per interval", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1900, max: 2200 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 28, max: 31 }),
    fc.integer({ min: 1, max: 12 }),
    (year, month, day, interval) => {
      const start = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      fc.pre(isCalendarDate(start));
      const dates = sequence(`every:${interval}month@${start}`, 48);
      assert.equal(dates.length, 48);
      assert.equal(new Set(dates).size, 48);
      dates.forEach((date, index) => {
        const target = new Date(Date.UTC(year, month - 1 + index * interval, 1));
        const finalDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(day, finalDay));
        assert.equal(date, target.toISOString().slice(0, 10));
      });
    },
  ), { seed: 44107, numRuns: 1000 });
});

test("generated leap-year schedules do not lose their anchor or duplicate dates", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1904, max: 2400 }),
    fc.integer({ min: 1, max: 8 }),
    (year, interval) => {
      const start = `${year}-02-29`;
      fc.pre(isCalendarDate(start));
      const dates = sequence(`every:${interval}year@${start}`, 24);
      assert.equal(new Set(dates).size, 24);
      dates.forEach((date, index) => {
        const targetYear = year + index * interval;
        const expected = new Date(Date.UTC(targetYear, 2, 0)).toISOString().slice(0, 10);
        assert.equal(date, expected);
      });
    },
  ), { seed: 44108, numRuns: 300 });
});

test("generated daily and weekly intervals advance by their exact number of days", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 100_000 }),
    fc.integer({ min: 1, max: 50 }),
    fc.constantFrom("day", "week"),
    (offset, interval, unit) => {
      const start = new Date(Date.UTC(1900, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
      const dates = sequence(`every:${interval}${unit}@${start}`, 20);
      dates.forEach((date, index) => {
        const elapsedDays = index * interval * (unit === "week" ? 7 : 1);
        const expected = new Date(new Date(`${start}T00:00:00Z`).getTime() + elapsedDays * 86_400_000).toISOString().slice(0, 10);
        assert.equal(date, expected);
      });
    },
  ), { seed: 44109, numRuns: 500 });
});

test("generated monthly RFC schedules retain interval phase and omit only invalid dates", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1900, max: 2200 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: -31, max: 31 }).filter((day) => day !== 0),
    (year, month, anchorDay, interval, requestedDay) => {
      const anchorDate = `${year}-${String(month).padStart(2, "0")}-${String(anchorDay).padStart(2, "0")}`;
      const rule = `rrule:FREQ=MONTHLY;INTERVAL=${interval};BYMONTHDAY=${requestedDay}`;
      const expected: string[] = [];
      for (let period = 0; period < 4800 && expected.length < 20; period += 1) {
        const target = new Date(Date.UTC(year, month - 1 + period * interval, 1));
        const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        const day = requestedDay < 0 ? lastDay + requestedDay + 1 : requestedDay;
        if (day < 1 || day > lastDay) continue;
        target.setUTCDate(day);
        const candidate = target.toISOString().slice(0, 10);
        if (candidate >= anchorDate) expected.push(candidate);
      }
      if (expected.length === 0) {
        assert.throws(() => firstDue(parseRecurrence(rule, anchorDate)), /supported calendar/);
      } else {
        assert.equal(expected.length, 20);
        const actual = sequence(rule, expected.length, anchorDate);
        assert.deepEqual(actual, expected);
        assert.equal(new Set(actual).size, actual.length);
      }
    },
  ), { seed: 44111, numRuns: 300 });
});

test("calendar exhaustion and a recurrence with no valid dates fail explicitly", () => {
  assert.throws(() => firstDue(parseRecurrence("rrule:FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=31", "2026-02-01")), /supported calendar/);
  assert.throws(() => nextDue(parseRecurrence("every:1day@9999-12-31", anchor), "9999-12-31"), /supported calendar/);
  assert.throws(() => nextDue(parseRecurrence("every:1month@9999-12-31", anchor), "9999-12-31"), /supported calendar/);
  assert.throws(() => nextDue(parseRecurrence("every:9007199254740991year@2026-01-01", anchor), "2026-01-01"), /supported calendar/);
});


test("instant guards reject normalized-away dates and require canonical UTC", () => {
  assert.equal(isInstant("2024-02-29T23:59:59.999Z"), true);
  for (const invalid of [
    "2026-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z", "0000-01-01T00:00:00.000Z",
    "2026-01-01T24:00:00.000Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000+00:00",
  ]) assert.equal(isInstant(invalid), false, invalid);
});
