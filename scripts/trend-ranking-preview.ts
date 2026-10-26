/** Explicit local SYNTHETIC preview; no providers, workflow dispatch or ad I/O. */
import {briefFixture,fixtureAt} from './trend-brief-fixtures';
import {fallbackStrategy,assembleStrategy,strategyDraftSchema} from '../src/lib/trend/strategy';
import {assembleStrategyReport} from '../src/lib/trend/strategy-report';
import {loadWorkspace,saveWorkspace} from '../src/lib/auth/workspace';
if(process.env.AISLE_DB==='postgres'||process.env.DATABASE_URL||process.env.POSTGRES_URL)throw Error('Local SQLite preview only.');
const c=briefFixture().c;c.id='cmp_ta06_ranking_fixture';c.name='TA-06 priorities & risks — SYNTHETIC review';c.run!.campaignId=c.id;
const risk=c.trendQuality!.findings.find(f=>f.category==='RISK')!;risk.material=true;risk.confidence='moderate';risk.limitation='SYNTHETIC opposing records shown to demonstrate uncertainty, not a real retail conclusion.';risk.conflict={evidenceIds:['current_market','historical_market'],explanation:'SYNTHETIC records concern different periods and cannot establish a single current preference.',explained:true};
const baseline=fallbackStrategy(c,fixtureAt,'SYNTHETIC preview; no model/provider calls');
const {recommendedAngle,audienceMotivation,keyMessage,visualDirection,alternativeConcept,channels,concepts,limitations}=baseline;
const insights=baseline.insights.map(({id,title,implication,application,findingIds,basis,limitation})=>({id,title,implication,application,findingIds,basis,limitation,resourceNeed:'existing_assets',potentialValue:'moderate'}));
c.strategy=assembleStrategy(c,strategyDraftSchema.parse({recommendedAngle,audienceMotivation,keyMessage,visualDirection,alternativeConcept,channels,concepts,limitations,insights}),fixtureAt,'SYNTHETIC local preview, not an observed market result');
c.structuredTrendBrief=assembleStrategyReport(c,fixtureAt);c.brief!.angle=c.strategy.recommendedAngle;c.brief!.visualDirection=c.strategy.visualDirection;
c.status='paused';c.running=false;c.run!.status='paused';
const workspace=await loadWorkspace('dev-alex','dev');await saveWorkspace('dev-alex',{...workspace,campaigns:[c,...workspace.campaigns.filter(v=>v.id!==c.id)]});
console.log('Saved one explicitly SYNTHETIC TA-06 local preview. Existing campaigns preserved. No calls or publication.');
