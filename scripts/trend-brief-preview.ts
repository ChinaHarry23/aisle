/** Local review fixtures only. Preserves existing campaigns and never calls a provider. */
import {readFileSync} from 'node:fs';
import {briefFixture,fixtureCandidate,fixtureAudit,fixtureAt} from './trend-brief-fixtures';
import {assembleBrief} from '../src/lib/trend/brief';
import {recordStoredTrend} from '../src/lib/trend/quality';
import {loadWorkspace,saveWorkspace} from '../src/lib/auth/workspace';
import type {Campaign} from '../src/lib/types';
const c=briefFixture().c;c.id='cmp_ta05_complete_fixture';c.name='TA-05 complete report — SYNTHETIC verification';c.run!.campaignId=c.id;c.trendBriefRequired=true;
const b=fixtureCandidate(c);c.structuredTrendBrief=assembleBrief(c,b,fixtureAudit(c,b),fixtureAt,'MOCK ONLY');
c.brief!.angle=b.themes[0].text;c.brief!.visualDirection=b.visualDirections[0].text;recordStoredTrend(c);c.status='paused';c.running=false;c.run!.status='paused';
const real=JSON.parse(readFileSync('docs/TA-05-LIVE-VALIDATION.json','utf8')).campaign as Campaign;
real.trendRequests=real.trendQuality!.requests;real.trendGaps=real.trendRequests.filter(r=>r.status==='pending').map(r=>({id:r.id,kind:'low_confidence',detail:r.reason,effect:r.neededData,needsFounder:true}));
real.id='cmp_ta05_abs_partial';real.name='TA-05 ABS public-source report — partial test campaign';real.run!.campaignId=real.id;real.structuredTrendBrief=assembleBrief(real,real.structuredTrendBrief!.candidate,real.structuredTrendBrief!.audit,real.structuredTrendBrief!.generatedAt,real.structuredTrendBrief!.modelStatus);real.status='paused';real.running=false;real.run!.status='paused';recordStoredTrend(real);
const workspace=await loadWorkspace('dev-alex','dev');const rows=[c,real];await saveWorkspace('dev-alex',{...workspace,campaigns:[...rows,...workspace.campaigns.filter(v=>!rows.some(f=>f.id===v.id))]});
console.log('Saved SYNTHETIC complete preview and actual ABS partial test report to the existing local dev workspace. No model calls or campaign dispatch.');
