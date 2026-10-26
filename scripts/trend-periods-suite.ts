import assert from 'node:assert/strict';
import { summarizeTrendSeries } from '../src/lib/trend/retrieval-context';

// Synthetic reproductions of the provider's period labels; no live API calls.
const asOf = '2026-10-26T09:14:15.772Z';
const row = (date: string, value: number | string, flags: Record<string, unknown> = {}) => ({ date, values: [{ extracted_value: value }], ...flags });
let count = 0;
const pass = (label: string) => { count++; console.log('PASS ' + label); };

const liveShape = summarizeTrendSeries([
  row('Sep 6\u2009–\u200912, 2026', 79), row('Sep 13\u2009–\u200919, 2026', 55),
  row('Sep 20\u2009–\u200926, 2026', 87), row('Sep 27\u2009–\u2009Oct 3, 2026', 100),
  row('Oct 4\u2009–\u200910, 2026', 59), row('Oct 11\u2009–\u200917, 2026', 47),
  row('Oct 18\u2009–\u200924, 2026', 62), row('Oct 25\u2009–\u200931, 2026', 75),
], asOf)!;
assert.equal(liveShape.periods, 7);
assert.equal(liveShape.lastPeriod, 'Oct 18\u2009–\u200924, 2026');
assert.equal(liveShape.latestInformationDate, '2026-10-18');
assert.equal(liveShape.latestCompletePeriodEnd, '2026-10-24');
assert.equal(liveShape.excludedPeriods.incomplete, 1);
assert.deepEqual(liveShape.comparison, { periodsPerWindow: 3, previousMeanIndex: 80.7, recentMeanIndex: 56, changeInIndexPoints: -24.7 });
pass('unflagged current week is removed before averages, peaks and adjacent comparisons');

const explicit = summarizeTrendSeries([
  row('Oct 18 – 24, 2026', 25), row('Oct 11 – 17, 2026', 100, { isPartial: true }),
  row('Oct 4 – 10, 2026', 90, { is_partial: 'true' }),
  { date: 'Sep 27 – Oct 3, 2026', values: [{ value: '80', is_partial: true }] },
], asOf)!;
assert.equal(explicit.periods, 1); assert.equal(explicit.peak.value, 25); assert.equal(explicit.excludedPeriods.partial, 3);
pass('row and value partial flags remain authoritative even for past dates');

const crossover = summarizeTrendSeries([
  row('Dec 28 – Jan 3, 2026', 10), row('Dec 28, 2025 – Jan 3, 2026', 20),
  row('Dec 27 – Jan 2, 2027', 90),
], '2026-01-04T12:00:00Z')!;
assert.equal(crossover.periods, 2); assert.equal(crossover.latestInformationDate, '2025-12-28');
assert.equal(crossover.latestCompletePeriodEnd, '2026-01-03'); assert.equal(crossover.excludedPeriods.incomplete, 1);
pass('cross-year weekly labels resolve their start and end years correctly');

const daily = summarizeTrendSeries([row('2026-10-24', 0), row('Oct 25, 2026', '0'), row('2026-10-26', 95)], asOf)!;
assert.equal(daily.periods, 2); assert.equal(daily.meanIndex, 0); assert.equal(daily.nonZeroPeriods, 0);
assert.equal(daily.latestCompletePeriodEnd, '2026-10-25'); assert.equal(daily.excludedPeriods.incomplete, 1);
pass('daily zero values remain observations and the unfinished current day is excluded');

const monthly = summarizeTrendSeries([row('September 2026', 30), row('2026-08', 10), row('Oct 2026', 100)], asOf)!;
assert.equal(monthly.periods, 2); assert.equal(monthly.firstPeriod, '2026-08');
assert.equal(monthly.latestCompletePeriodEnd, '2026-09-30'); assert.equal(monthly.meanIndex, 20);
pass('monthly periods finish at the actual month end and are ordered chronologically');

const years = summarizeTrendSeries([row('2025', 10), row('2026', 99)], asOf)!;
assert.equal(years.periods, 1); assert.equal(years.latestCompletePeriodEnd, '2025-12-31');
pass('annual periods do not count a year that is still underway');

const unknown = summarizeTrendSeries([
  row('2026-10-18 - 2026-10-24', 15), row('week 50', 80, { timestamp: '1792281600' }),
  row('Feb 30, 2026', 80), row('2026-13-05', 80), row('Oct 30 – 24, 2026', 80),
  row('Oct 11 – 17, 2026', '100+'), row('Oct 4 – 10, 2026', 101),
], asOf)!;
assert.equal(unknown.periods, 1); assert.equal(unknown.excludedPeriods.unknownPeriod, 4); assert.equal(unknown.excludedPeriods.invalid, 2);
assert.match(unknown.limitation, /unknown intervals are excluded/);
pass('unrecognized or invalid intervals are reported instead of inferring a period end from timestamps');

assert.equal(summarizeTrendSeries([row('Oct 25 – 31, 2026', 100)], asOf), null);
assert.equal(summarizeTrendSeries([row('unknown', 10)], asOf), null);
assert.equal(summarizeTrendSeries([row('Oct 18 – 24, 2026', 10)], 'not-a-date'), null);
assert.equal(summarizeTrendSeries([row('Oct 18 – 24, 2026', 10)], '2026-10-24T23:59:59Z'), null);
assert.equal(summarizeTrendSeries([row('Oct 18 – 24, 2026', 10)], '2026-10-25T00:00:00Z')!.periods, 1);
pass('no completed dated observations means no numeric summary, including on the final day of a period');

console.log(`Passed ${count} Trends period groups.`);
