/** Paused SYNTHETIC UI fixtures only. No dispatch, model or provider calls. */
import {briefFixture,fixtureAt} from './trend-brief-fixtures';
import {fallbackStrategy} from '../src/lib/trend/strategy';
import {assembleStrategyReport} from '../src/lib/trend/strategy-report';
import {recordStoredTrend} from '../src/lib/trend/quality';
import {prepareDelivery,markDeliveryStored,acknowledgeDelivery} from '../src/lib/trend/delivery';
import {loadWorkspace,saveWorkspace} from '../src/lib/auth/workspace';
const fixtures=['pending','failed','accepted'].map(state=>{
 const {c}=briefFixture();c.id='cmp_ta07_'+state+'_fixture';c.name='SYNTHETIC TA07: '+state+' handoff';c.run!.campaignId=c.id;c.trendBriefRequired=true;
 c.strategy=fallbackStrategy(c,fixtureAt,'SYNTHETIC UI fixture only');c.structuredTrendBrief=assembleStrategyReport(c,fixtureAt);recordStoredTrend(c);prepareDelivery(c,fixtureAt);markDeliveryStored(c);
 if(state==='failed'){c.trendDelivery!.state='FAILED';c.trendDelivery!.attempts=1;c.trendDelivery!.error='SYNTHETIC outage: content generation is unavailable. Your complete report is saved; retry the handoff only.';}
 if(state==='accepted')acknowledgeDelivery(c,fixtureAt);
 markDeliveryStored(c);c.status='paused';c.running=false;c.run!.status='paused';c.run!.step=state==='accepted'?'creative.generate':'creative.receive';c.run!.haltedReason='Paused SYNTHETIC UI fixture. Do not launch: no real campaign or provider run.';return c;
});
const workspace=await loadWorkspace('dev-alex','dev');await saveWorkspace('dev-alex',{...workspace,campaigns:[...fixtures,...workspace.campaigns.filter(c=>!fixtures.some(f=>f.id===c.id))]});console.log('Saved three paused SYNTHETIC TA07 UI fixtures; no provider calls.');
