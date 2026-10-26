import type { Campaign } from '@/lib/types';
import { BRIEF_SECTIONS } from './brief-contracts';
import type { FindingCategory } from './quality-contracts';

export const sectionCategories:Record<typeof BRIEF_SECTIONS[number],FindingCategory[]>={market_summary:['MARKET'],current_trends:['MARKET','TREND'],historical_trends:['TREND'],customer_interests:['CUSTOMER'],purchasing_preferences:['CUSTOMER'],seasonal:['SEASONAL_CULTURAL'],cultural:['SEASONAL_CULTURAL'],channel:['OPPORTUNITY','RISK','MARKET','TREND','CUSTOMER'],competitor:['COMPETITOR'],opportunities:['OPPORTUNITY'],risks:['RISK']};
export const sectionResearch:Partial<Record<typeof BRIEF_SECTIONS[number],string>>={market_summary:'current_market',current_trends:'current_market',historical_trends:'historical_market',customer_interests:'customer_interest',purchasing_preferences:'purchase_preference',seasonal:'seasonal',cultural:'cultural',channel:'channel',competitor:'competitor'};
export function requiredBriefSections(c:Campaign){return BRIEF_SECTIONS.flatMap(key=>(key==='channel'?c.channels:[null]).map(channel=>({key,channel})));}
