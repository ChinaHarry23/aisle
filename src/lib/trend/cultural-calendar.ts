import type { Campaign } from '@/lib/types';

/**
 * The 2026 Home Affairs cultural calendar, read once and stored here.
 * Research looks up a product in this index. It does not search the page again.
 * Product terms are retail associations for the campaign scene, not quotations
 * from the page and not measured demand.
 */
export const CULTURAL_CALENDAR_URL =
  'https://www.homeaffairs.gov.au/about-us/our-portfolios/multicultural-affairs/about-multicultural-affairs/calendar-of-cultural-and-religious-dates';

export type CulturalMatch = {
  occasionId: string;
  name: string;
  dateLabel: string;
  scene: string;
  reason: string;
  listedOnCalendar: boolean;
  sourceUrl: string;
  sourceNote: string;
};

type Occasion = {
  id: string;
  name: string;
  dateLabel: string;
  start: { month: number; day: number };
  end: { month: number; day: number };
  products: string[];
  scene: string;
  listedOnCalendar: boolean;
  sourceNote: string;
};

const SCENE_LIMIT = 'The match directs the campaign scene and is not a measured demand figure.';

const OCCASIONS: Occasion[] = [
  {
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    dateLabel: '17-21 Feb 2026',
    start: { month: 2, day: 17 },
    end: { month: 2, day: 21 },
    products: ['dumpling', 'dumplings', 'rice cake', 'nian gao', 'spring roll', 'spring rolls'],
    scene: 'Show the product as the hero of a Lunar New Year family table: red and gold accents, warm indoor light, and a shared meal. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Lunar New Year on 17-21 Feb, including Chinese Lunar New Year, Tet and Seollal on 17 Feb. Family gatherings are a common feature.',
  },
  {
    id: 'shrove-tuesday',
    name: 'Shrove Tuesday',
    dateLabel: '17 Feb 2026',
    start: { month: 2, day: 17 },
    end: { month: 2, day: 17 },
    products: ['pancake', 'pancakes', 'hotcake', 'hotcakes'],
    scene: 'Show the pancakes as the hero of a Shrove Tuesday table: a stack on a plate, lemon and a small jug, in warm kitchen light. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Shrove Tuesday on 17 Feb, the last day before Lent in the Christian calendar.',
  },
  {
    id: 'ramadan',
    name: 'Ramadan',
    dateLabel: '16 Feb-18 Mar 2026',
    start: { month: 2, day: 16 },
    end: { month: 3, day: 18 },
    products: ['medjool', 'medjool dates', 'pitted dates', 'dates'],
    scene: 'Show the dates as the hero of a quiet evening iftar table: a small bowl of dates, warm low light, and a simple setting. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Ramadan from 16 Feb to 18 Mar. It is the Islamic month of fasting.',
  },
  {
    id: 'lantern-festival',
    name: 'Lantern Festival',
    dateLabel: '3 Mar 2026',
    start: { month: 3, day: 3 },
    end: { month: 3, day: 3 },
    products: ['tangyuan', 'yuanxiao', 'glutinous rice ball', 'glutinous rice balls'],
    scene: 'Show the rice balls as the hero of a Lantern Festival table: a bowl of round rice balls, warm lantern light, and a night setting. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists the Lantern Festival (Yuanxiao Festival) on 3 Mar, the fifteenth day of the first lunar month.',
  },
  {
    id: 'eid-al-fitr',
    name: 'Eid al Fitr',
    dateLabel: '19-20 Mar 2026',
    start: { month: 3, day: 19 },
    end: { month: 3, day: 20 },
    products: ['baklava'],
    scene: 'Show the baklava as the hero of an Eid al Fitr celebration table: a shared sweet, bright daylight, and a generous but uncluttered spread. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Eid al Fitr on 19-20 Mar, the festival that ends Ramadan, marked with a celebratory meal.',
  },
  {
    id: 'passover',
    name: 'Passover',
    dateLabel: '1-9 Apr 2026',
    start: { month: 4, day: 1 },
    end: { month: 4, day: 9 },
    products: ['matzah', 'matzo', 'matzoh'],
    scene: 'Show the matzah as the hero of a Passover table: stacked unleavened bread, a simple white cloth, and calm evening light. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Passover on 1-9 Apr, the Jewish festival recalling the redemption from slavery in Egypt.',
  },
  {
    id: 'easter',
    name: 'Easter',
    dateLabel: '5 Apr 2026',
    start: { month: 4, day: 3 },
    end: { month: 4, day: 6 },
    products: ['hot cross bun', 'hot cross buns', 'easter egg', 'easter eggs'],
    scene: 'Show the product as the hero of an Easter table: hot cross buns or Easter eggs in soft morning light, with a simple spring sprig. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Easter Sunday on 5 Apr for Protestant and Catholic Christians, with Good Friday on 3 Apr and Easter Monday on 6 Apr.',
  },
  {
    id: 'mid-autumn',
    name: 'Mid-Autumn Festival',
    dateLabel: '25 Sep 2026',
    start: { month: 9, day: 25 },
    end: { month: 9, day: 25 },
    products: ['mooncake', 'mooncakes', 'moon cake', 'moon cakes'],
    scene: 'Show the mooncake as the hero of a Mid-Autumn table: round cakes, a teacup, warm lantern light, and a night setting. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Mid-Autumn (Moon) Festival, also named Zhōngqiū Jié and Tết Trung Thu, on 25 Sep.',
  },
  {
    id: 'halloween',
    name: 'Halloween',
    dateLabel: '31 Oct',
    start: { month: 10, day: 31 },
    end: { month: 10, day: 31 },
    products: ['pumpkin', 'pumpkins', 'jack-o-lantern', 'jack o lantern', "jack-o'-lantern"],
    scene: 'Show the pumpkin as the hero of a Halloween grocery display: one whole pumpkin, warm evening light, a few autumn leaves, and a dark wooden table. No horror imagery and no children.',
    listedOnCalendar: false,
    sourceNote: 'Halloween is not named on the 2026 Home Affairs calendar. The nearest listed observances are All Saints’ Day (1 Nov), All Souls’ Day (2 Nov) and Dia de los Muertos (2 Nov). Pumpkin is a common retail association for Halloween.',
  },
  {
    id: 'dia-de-los-muertos',
    name: 'Dia de los Muertos',
    dateLabel: '2 Nov 2026',
    start: { month: 11, day: 2 },
    end: { month: 11, day: 2 },
    products: ['pan de muerto'],
    scene: 'Show the pan de muerto as the hero of a Dia de los Muertos table: the bread centred, marigold colour in the background, and warm candlelight. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Dia de los Muertos (Day of the Dead) on 2 Nov, combining older ancestor customs with All Souls’ Day.',
  },
  {
    id: 'deepavali',
    name: 'Deepavali',
    dateLabel: '8 Nov 2026',
    start: { month: 11, day: 8 },
    end: { month: 11, day: 8 },
    products: ['gulab jamun', 'barfi', 'soan papdi', 'mithai', 'diwali sweet', 'diwali sweets'],
    scene: 'Show the sweet as the hero of a Deepavali table: a small plate of sweets, warm points of light, and a gold accent. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Deepavali on 8 Nov. It is also known as Diwali, Tihar and the Festival of Lights.',
  },
  {
    id: 'chanukah',
    name: 'Chanukah',
    dateLabel: '4-12 Dec 2026',
    start: { month: 12, day: 4 },
    end: { month: 12, day: 12 },
    products: ['latke', 'latkes', 'sufganiyah', 'sufganiyot'],
    scene: 'Show the latke or sufganiyah as the hero of a Chanukah table: the food in warm light, with a simple row of candles in the background. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Chanukah on 4-12 Dec, the eight-day Jewish festival marked by lighting an additional candle each night.',
  },
  {
    id: 'christmas',
    name: 'Christmas',
    dateLabel: '25 Dec 2026',
    start: { month: 12, day: 25 },
    end: { month: 12, day: 25 },
    products: ['mince pie', 'mince pies', 'christmas pudding', 'panettone', 'candy cane', 'candy canes', 'fruit mince'],
    scene: 'Show the product as the hero of a Christmas table: the food large in frame, warm indoor light, and a small amount of greenery. No children.',
    listedOnCalendar: true,
    sourceNote: 'The 2026 Home Affairs calendar lists Christmas Day on 25 Dec, the Christian celebration of the birth of Jesus, widely marked in Australia.',
  },
];

function mentions(haystack: string, term: string): boolean {
  const body = term.trim().toLowerCase();
  if (body.length < 4) return false;
  const pattern = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(haystack);
}

function utc(year: number, month: number, day: number) {
  return Date.UTC(year, month - 1, day);
}

function overlaps(start: string, end: string, occasion: Occasion): boolean {
  const year = Number(start.slice(0, 4));
  const campaignStart = Date.parse(start);
  const campaignEnd = Date.parse(end);
  if (!Number.isInteger(year) || !Number.isFinite(campaignStart) || !Number.isFinite(campaignEnd)) return false;
  return campaignStart <= utc(year, occasion.end.month, occasion.end.day) && campaignEnd >= utc(year, occasion.start.month, occasion.start.day);
}

function distanceDays(start: string, occasion: Occasion): number {
  const year = Number(start.slice(0, 4));
  const campaign = Date.parse(start);
  if (!Number.isInteger(year) || !Number.isFinite(campaign)) return 366;
  const raw = Math.abs(campaign - utc(year, occasion.start.month, occasion.start.day)) / 86_400_000;
  return Math.min(raw, 366 - raw);
}

export function noCulturalMatchReason(product: string): string {
  const name = product.trim() || 'This product';
  return `No grocery occasion in the compiled cultural calendar matches ${name}, so cultural holiday search was not run.`;
}

function toMatch(product: string, occasion: Occasion): CulturalMatch {
  const reason = `${product.trim()} matches ${occasion.name} (${occasion.dateLabel}) in the compiled cultural occasion index. ${occasion.sourceNote} ${SCENE_LIMIT}`.slice(0, 500);
  return {
    occasionId: occasion.id,
    name: occasion.name,
    dateLabel: occasion.dateLabel,
    scene: occasion.scene,
    reason,
    listedOnCalendar: occasion.listedOnCalendar,
    sourceUrl: CULTURAL_CALENDAR_URL,
    sourceNote: occasion.sourceNote,
  };
}

/** Local lookup. Null means the index was searched and this product has no occasion. */
export function retrieveCulturalOccasion(c: Pick<Campaign, 'product' | 'category' | 'startDate' | 'endDate'>): CulturalMatch | null {
  const haystack = ` ${c.product} ${c.category} `.toLowerCase();
  const ranked = OCCASIONS.flatMap((occasion) => {
    const matched = occasion.products.filter((term) => mentions(haystack, term));
    if (!matched.length) return [];
    const score = Math.max(...matched.map((term) => term.length));
    return [{ occasion, score, near: overlaps(c.startDate, c.endDate, occasion) ? 1 : 0, distance: distanceDays(c.startDate, occasion) }];
  }).sort((a, b) => b.score - a.score || b.near - a.near || a.distance - b.distance || a.occasion.name.localeCompare(b.occasion.name));
  const best = ranked[0];
  return best ? toMatch(c.product, best.occasion) : null;
}

export function culturalDirection(match: CulturalMatch | null | undefined): string {
  if (!match) return '';
  return `Cultural occasion for this product: ${match.name} (${match.dateLabel}). ${match.scene}`;
}

export function withCulturalScene(direction: string, match: CulturalMatch | null | undefined): string {
  const line = culturalDirection(match);
  if (!line || direction.includes('Cultural occasion for this product:')) return direction;
  const base = direction.trim();
  return base ? `${base} ${line}` : line;
}

/** Record the one-time calendar lookup on the cultural research area. */
export function applyCulturalCalendar(c: Campaign): void {
  if (c.culturalMatch === undefined) return;
  const match = c.culturalMatch;
  const summary = match ? match.reason : noCulturalMatchReason(c.product);
  const limitation = match
    ? 'Cultural holiday search was not repeated. This occasion comes from the compiled calendar and directs the picture; it is not a measured demand series.'
    : 'Cultural holiday search was not run because this product does not match an occasion in the compiled calendar.';
  for (const area of c.researchCoverage ?? []) {
    if (area.category !== 'cultural') continue;
    area.limitation = summary;
    area.analysis = { category: 'cultural', summary, evidenceIds: [], limitation };
  }
}
