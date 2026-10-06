import { reconcileBackdatedCycles } from './cycle-rebuild.mjs';
import { snapshotStrategyTransaction } from './strategy-transaction.mjs';
import {historicalEntryStandard,resolveEntryPlan} from './entry-standard-plan.mjs';
import { buildCycles } from './trade-engine.mjs';
import { buildCurrentEquity } from './portfolio-engine.mjs';
import { toProviderSymbol, pnlToUsd, USDTWD_SYMBOL } from './quote-engine.mjs';
import { activeStrategyVersion, createStrategyAssignment, findStrategyVersion, updateStrategyCheck } from './strategy-engine.mjs';

export const ACTION_LABELS = { ENTRY: '新建倉', ADD: '加碼', REDUCE: '減碼', EXIT: '平倉', REVERSAL: '反手' };
export const ENTRY_OPTIONS = [['BREAKOUT','突破'],['PULLBACK','回測'],['REVERSAL','轉折'],['CONTINUATION','趨勢延續'],['OTHER','其他'],['UNCLASSIFIED','待分類']];
export const VOLUME_OPTIONS = [['VOLUME_UP_PRICE_UP','放量上漲'],['VOLUME_UP_PRICE_DOWN','放量下跌'],['LOW_VOLUME_RANGE','縮量整理'],['RANGE_BREAKOUT','突破區間'],['RANGE_BREAKDOWN','跌破區間'],['SUPPORT_RETEST','支撐回測'],['RESISTANCE_TEST','壓力測試']];
export const ADD_OPTIONS = [['PLANNED','原計畫分批'],['PROFIT_ADD','獲利後追加'],['RETEST','回測確認'],['LOSS_ADD','虧損中追加'],['OTHER','其他'],['PENDING','待補']];
export const STOP_OPTIONS = [['HISTORICAL_STANDARD','歷史標準'],['ORIGINAL','原計畫'],['SUPPORT_FAILURE','支撐／壓力失效'],['RANGE_FAILURE','價格區間失效'],['CUSTOM','自訂'],['UNSET','尚未設定']];
export const TARGET_OPTIONS = [['HISTORICAL_STANDARD','歷史標準'],['ORIGINAL','原計畫'],['PRICE_TARGET','目標價位'],['REWARD_RISK','風報目標'],['CUSTOM','自訂'],['UNSET','尚未設定']];
export const CHECK_OPTIONS = [['CONFIRMED','符合'],['NOT_MET','不符合'],['UNREVIEWED','待確認']];
const copy = (value) => JSON.parse(JSON.stringify(value));
const positive = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) > 0;
export const marketCurrency = (market) => ['TWSE','TPEX','TSE','TAIWAN','OTC'].includes(market) ? 'TWD' : 'USD';
export const entryEvidenceKey = (draft) => `${draft.id}:${draft.accountId}:${draft.market}:${String(draft.symbol || '').trim().toUpperCase()}:${marketDate(draft.timestamp,draft.market)}`;
export function marketDate(timestamp, market = 'NASDAQ') {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {timeZone: marketCurrency(market) === 'TWD' ? 'Asia/Taipei' : 'America/New_York', year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function createEntryDraft(accounts = [], now = new Date().toISOString(), id = `fill-${globalThis.crypto.randomUUID()}`) {
  const account = accounts[0];
  const date = new Date(now);
  return { formatVersion:2, id, accountId: account?.id || '', market: account?.currency === 'TWD' ? 'TWSE' : 'NASDAQ', symbol:'', side:'BUY', quantity:'', price:'', fee:'0', timestamp: new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16), note:'', entrySetup:'UNCLASSIFIED', volumeTags:[], addReason:'PENDING', stopBasis:'UNSET', targetBasis:'UNSET', stopLoss:undefined, takeProfit:undefined, strategyId:'', strategyVersionId:'', ruleChecks:{}, confirmedKey:'', createdAt:now, updatedAt:now };
}

export function validateEntryDraft(data, draft, now = new Date().toISOString()) {
  const errors = [];
  const planErrors = [];
  const account = (data.accounts || []).find((item) => item.id === draft.accountId);
  if (!account) errors.push('請選擇交易帳戶');
  if (!['NASDAQ','NYSE','AMEX','TWSE','TPEX'].includes(draft.market)) errors.push('請選擇有效市場');
  const currency = marketCurrency(draft.market);
  if (account && account.currency !== currency) errors.push(`帳戶幣別 ${account.currency} 與市場 ${currency} 不符，請選擇相符帳戶`);
  const symbol = String(draft.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) errors.push('請輸入有效標的代號');
  if (!['BUY','SELL'].includes(draft.side)) errors.push('買賣方向無效');
  for (const [key,label] of [['quantity','股數'],['price','成交價']]) if (!positive(draft[key])) errors.push(`${label}必須為大於零的有限數字`);
  if (draft.fee === '' || !Number.isFinite(Number(draft.fee)) || Number(draft.fee) < 0) errors.push('手續費必須為零或正數');
  for (const key of ['stopLoss','takeProfit']) if (draft[key] != null && draft[key] !== '' && !positive(draft[key])) planErrors.push(`${key === 'stopLoss' ? '停損' : '停利'}價必須為正數，未設定請留空`);
  const time = new Date(draft.timestamp).getTime();
  if (!Number.isFinite(time)) errors.push('成交時間無效');
  else if (time > new Date(now).getTime()) errors.push('只能登錄已發生的成交，不能使用未來時間');
  if (!draft.id || (data.fills || []).some((fill) => fill.id === draft.id)) errors.push('成交識別碼重複或遺失，請重新開啟登錄頁');
  for (const [key, options] of [['entrySetup',ENTRY_OPTIONS],['addReason',ADD_OPTIONS],['stopBasis',STOP_OPTIONS],['targetBasis',TARGET_OPTIONS]]) if (draft[key] && !options.some(([value])=>value===draft[key])) errors.push('勾選標籤無效，請重新選擇');
  if (draft.volumeTags && (!Array.isArray(draft.volumeTags) || draft.volumeTags.some((tag)=>!VOLUME_OPTIONS.some(([value])=>value===tag)))) errors.push('量價標籤無效');
  return { errors:[...errors,...planErrors], fill: errors.length ? null : {id:draft.id,accountId:draft.accountId,market:draft.market,currency,symbol,side:draft.side,quantity:Number(draft.quantity),price:Number(draft.price),fee:Number(draft.fee),timestamp:new Date(time).toISOString(),note:String(draft.note || '')} };
}

const allCycles = (result) => [...result.cycles, ...result.positions];
const fillKey = (fill) => `${fill.originalFillId || fill.id}:${fill.splitRole || ''}`;
function annotatedCycleIds(data, old) {
  const ids = new Set([...Object.keys(data.cycleReviews || {}),...Object.keys(data.strategyAssignments || {}),...(data.planHistory || []).map((item) => item.cycleId),...Object.values(data.entryContexts || {}).map((item) => item.cycleId)]);
  for (const cycle of old) if (data.positionPlans?.[cycle.id] || data.positionPlans?.[`${cycle.accountId}:${cycle.symbol}`]) ids.add(cycle.id);
  for (const key of Object.keys(data.decisionLinks || {})) key.split('>').forEach((id) => ids.add(id));
  return ids;
}
export function previewEntry(data, draft, now = new Date().toISOString()) {
  const validation = validateEntryDraft(data, draft, now);
  if (!validation.fill) return {...validation, action:null, before:null, after:null, affected:[], confirmationKey:'', assignment:null, plan:{}, sameTime:false, historical:false};
  const fill = validation.fill;
  // Stable timestamp order: a newly registered same-time fill follows existing fills.
  const prefix = (data.fills || []).filter((item) => new Date(item.timestamp) <= new Date(fill.timestamp));
  const beforeResult = buildCycles({fills:prefix,marketBars:[]});
  const before = beforeResult.positions.find((position) => position.accountId === fill.accountId && position.symbol === fill.symbol) || null;
  const afterResult = buildCycles({fills:[...prefix,fill],marketBars:[]});
  const after = afterResult.positions.find((position) => position.accountId === fill.accountId && position.symbol === fill.symbol) || null;
  const sameSide = before?.direction === (fill.side === 'BUY' ? 'LONG' : 'SHORT');
  const action = !before ? 'ENTRY' : sameSide ? 'ADD' : fill.quantity > before.quantity + 1e-9 ? 'REVERSAL' : Math.abs(fill.quantity-before.quantity)<1e-9 ? 'EXIT' : 'REDUCE';
  if (action === 'EXIT') validation.errors = validation.errors.filter((message)=>!message.startsWith('停損價') && !message.startsWith('停利價'));
  const cycleId = action === 'EXIT' ? before.id : after.id;
  const old = allCycles(buildCycles({fills:data.fills,marketBars:[]}));
  const next = allCycles(buildCycles({fills:[...data.fills,fill],marketBars:[]}));
  const membership = new Map(next.flatMap((cycle) => cycle.fills.map((item) => [fillKey(item),cycle.id])));
  const annotated = annotatedCycleIds(data, old);
  const affected = old.filter((cycle) => annotated.has(cycle.id) && cycle.fills.some((item) => membership.get(fillKey(item)) !== cycle.id)).map((cycle) => ({cycleId:cycle.id,symbol:cycle.symbol,openAt:cycle.openAt}));
  const plan = before?.id === cycleId ? inheritedEntryPlan(data, {cycleId,accountId:fill.accountId,symbol:fill.symbol,timestamp:fill.timestamp}) : {};
  const assignment = data.strategyAssignments?.[cycleId] || null;
  const key = JSON.stringify([fill,action,before?.id,before?.quantity,before?.averageCost,after?.id,after?.quantity,after?.averageCost]);
  return {...validation,action,before,after,cycleId,affected,plan,assignment,confirmationKey:key,sameTime:prefix.some((item) => item.accountId===fill.accountId && item.symbol===fill.symbol && new Date(item.timestamp).getTime()===new Date(fill.timestamp).getTime()),historical:marketDate(fill.timestamp,fill.market)<marketDate(now,fill.market)};
}

export function inheritedEntryPlan(data, context) {
  const stored = data.positionPlans?.[context.cycleId] || data.positionPlans?.[`${context.accountId}:${context.symbol}`];
  // A known later plan is not evidence of what existed at a historical fill.
  const plan = stored && (!stored.updatedAt || stored.updatedAt <= context.timestamp) ? {...stored} : {};
  const references = {};
  for (const field of ['stopLoss','takeProfit']) {
    const versions = (data.planHistory || []).filter((item) => item.cycleId === context.cycleId && item.field === field && item.effectiveAt && item.effectiveAt <= context.timestamp).sort((a,b) => a.effectiveAt.localeCompare(b.effectiveAt));
    const latest = versions.at(-1);
    if (latest) { plan[field] = latest.value; references[field] = latest.id; }
  }
  return {...plan,references,legacy:!!stored && !stored.updatedAt};
}

export function buildEntryEvidence(bars = [], timestamp, market, symbol, fetchedAt = null, source = '') {
  const day = marketDate(timestamp,market);
  const unique = new Map();
  for (const bar of bars) if (bar.symbol === symbol && /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && ['open','high','low','close'].every((key) => positive(bar[key])) && Number(bar.high)>=Math.max(Number(bar.open),Number(bar.close),Number(bar.low)) && Number(bar.low)<=Math.min(Number(bar.open),Number(bar.close))) unique.set(bar.date, {...bar,volume:bar.volume != null && Number.isFinite(Number(bar.volume)) && Number(bar.volume)>=0 ? Number(bar.volume) : null});
  const prior = [...unique.values()].filter((bar) => bar.date < day).sort((a,b) => a.date.localeCompare(b.date)).slice(-11);
  const candles = prior.slice(-10);
  const average = (rows) => rows.length === 10 && rows.every((bar) => bar.volume != null) ? rows.reduce((sum,bar) => sum+bar.volume,0)/10 : null;
  const priorAverage = prior.length === 11 ? average(prior.slice(0,10)) : null;
  const latestVolume = prior.at(-1)?.volume ?? null;
  return {day,candles,volumeBaseline:prior.slice(0,-1),averageVolume10:average(candles),priorAverageVolume10:priorAverage,volumeRatio:priorAverage>0 && latestVolume != null ? latestVolume/priorAverage : null,fillDayBar:unique.get(day) || null,precision:'日線近似',fetchedAt,source,complete: candles.length === 10};
}

/** @param {any} data @param {any} preview @param {any} draft @param {any} snapshot */
export function entryValuation(data, preview, draft, snapshot) {
  const reasons = [];
  const quotes = snapshot?.quotes || {};
  const now = snapshot?.capturedAt || new Date().toISOString();
  const fx = Number(quotes[USDTWD_SYMBOL]?.price);
  const fill = preview.fill;
  const blank = {reasons,asOf:now,navUsd:null,mark:null,fxRate:positive(fx)?fx:null,positionPct:null,addedPct:null,originalUnrealizedUsd:null,stop:null,target:null,quotes};
  if (!fill) return {...blank,reasons:['請先填妥成交基本資料']};
  if (preview.historical || marketDate(fill.timestamp,fill.market) !== marketDate(now,fill.market)) return {...blank,reasons:['歷史補登缺少成交當時估值快照；不以今日淨值推算當時曝險']};
  const virtual = {...data,fills:[...data.fills,fill]};
  const positions = buildCycles({fills:virtual.fills,marketBars:[]}).positions;
  for (const position of positions) {
    const quote = quotes[toProviderSymbol(position.symbol,position.market)];
    if (!positive(quote?.price) || quote?.currency !== position.currency || !quote.updatedAt) reasons.push(`缺少 ${position.symbol} 有效報價／幣別／時間`);
  }
  const currencies = new Set([...virtual.fills.map((item)=>item.currency),...(virtual.cashActivities || []).map((item)=>item.currency).filter(Boolean)]);
  if ([...currencies].some((currency)=>!['USD','TWD'].includes(currency))) reasons.push('存在不支援的幣別');
  if (currencies.has('TWD') && (!positive(fx) || !quotes[USDTWD_SYMBOL]?.updatedAt)) reasons.push('缺少 USD/TWD 匯率快照');
  const equity = buildCurrentEquity(virtual,quotes,fx,new Date(now));
  if (!positive(equity.totalUsd)) reasons.push('帳號淨值未提供或不為正數');
  const quote = quotes[toProviderSymbol(fill.symbol,fill.market)];
  const mark = positive(quote?.price) && quote.currency===fill.currency ? Number(quote.price) : null;
  if (preview.after && !mark && !reasons.length) reasons.push('缺少參考現價');
  if (reasons.length) return blank;
  const usd = (value) => pnlToUsd({[fill.currency]:value},fx);
  const position = preview.after;
  const direction = position?.direction==='SHORT' ? -1 : 1;
  const targetOutcome = (price) => !position || !positive(price) ? null : {price:Number(price),assetChangeUsd:usd(direction*(Number(price)-mark)*position.quantity),assetChangePct:usd(direction*(Number(price)-mark)*position.quantity)/equity.totalUsd,costPnlUsd:usd(direction*(Number(price)-position.averageCost)*position.quantity)};
  const addedQuantity = ['ENTRY','ADD'].includes(preview.action) ? fill.quantity : preview.action==='REVERSAL' ? position.quantity : 0;
  return {...blank,navUsd:equity.totalUsd,mark,positionPct:position ? usd(position.quantity*mark)/equity.totalUsd : 0,addedPct:addedQuantity ? usd(addedQuantity*mark)/equity.totalUsd : 0,originalUnrealizedUsd:preview.before ? usd((preview.before.direction==='SHORT'?-1:1)*(fill.price-preview.before.averageCost)*preview.before.quantity) : null,stop:targetOutcome(draft.stopLoss ?? preview.plan?.stopLoss),target:targetOutcome(draft.takeProfit ?? preview.plan?.takeProfit)};
}

export function contextsForCycle(contexts = {}, cycleId) { return Object.values(contexts).filter((item) => item.cycleId === cycleId || item.strategyStages?.some(stage => stage.cycleId === cycleId)).sort((a,b)=>a.fillTimestamp.localeCompare(b.fillTimestamp)); }
export function filterCyclesByEntry(cycles, contexts = {}, setup = '', volume = '', add = '') {
  return cycles.filter((cycle) => { const rows = contextsForCycle(contexts,cycle.id); return (!setup || rows.some((row)=>row.entrySetup===setup)) && (!volume || rows.some((row)=>row.volumeTags?.includes(volume))) && (!add || (add==='yes' ? rows.some((row)=>row.action==='ADD') : rows.length>0 && !rows.some((row)=>row.action==='ADD'))); });
}
export function entryReplayEvents(cycle, contexts = {}) {
  return contextsForCycle(contexts,cycle.id).map((context,index)=>({id:`entry-context:${context.fillId}`,type:'ENTRY_CONTEXT',date:marketDate(context.recordedAt,cycle.market),timestamp:context.recordedAt,price:null,label:`${ACTION_LABELS[context.action]}・事後登錄`,detail:`成交 ${context.fillTimestamp}｜${ENTRY_OPTIONS.find(([key])=>key===context.entrySetup)?.[1] || '不適用'}｜${context.note || '未填理由'}｜計畫 ${Object.values(context.planReferences || {}).join('、') || '待補／歷史值'}`,source:'USER',sortOrder:800+index,entryContext:context}));
}

/** Atomic user-data transaction; callers must save the returned Dataset, never partial pieces. */
export function commitEntry(data, draft, snapshot, now = new Date().toISOString()) {
  let preview = previewEntry(data,draft,now);
  if (draft.formatVersion===2 && !preview.errors.length) {
    draft=resolveEntryPlan(draft,preview,historicalEntryStandard(data,draft.timestamp));
    preview=previewEntry(data,draft,now);
  }
  if (preview.errors.length) throw new Error(preview.errors.join('；'));
  if (draft.confirmedKey !== preview.confirmationKey) throw new Error('請重新確認系統判定的操作與前後股數');
  const {fill,cycleId} = preview;
  const strategyStages = snapshotStrategyTransaction(data, draft, preview, now);
  const entryApplicable = ['ENTRY','ADD','REVERSAL'].includes(preview.action);
  let assignment = preview.assignment;
  let strategyVersion = assignment ? findStrategyVersion(data.strategies,assignment.strategyId,assignment.strategyVersionId).version : null;
  let newAssignment = false;
  if (entryApplicable && !assignment && draft.strategyId) {
    const strategy = (data.strategies || []).find((item)=>item.id===draft.strategyId);
    if (strategy?.status !== 'ACTIVE') throw new Error('所選策略已停用，請重新選擇或選未指定');
    strategyVersion = activeStrategyVersion(strategy);
    if (!strategyVersion || strategyVersion.id !== draft.strategyVersionId) throw new Error('策略版本已更新，請重新確認選取版本');
    assignment = createStrategyAssignment({id:cycleId,openAt:preview.after.openAt},strategy,'POST_TRADE_ENTRY',now);
    newAssignment = true;
  }
  const checks = {};
  if (entryApplicable) for (const rule of strategyVersion?.rules || []) if (rule.group!=='EXIT_TRIGGER') {
    const status = draft.strategySelections?.ENTRY?.checks?.[rule.id] || draft.ruleChecks?.[rule.id] || 'UNREVIEWED';
    if (!CHECK_OPTIONS.some(([key])=>key===status)) throw new Error('規則確認狀態無效');
    checks[rule.id] = {status,checkedAt:status==='UNREVIEWED'?null:now,source:'POST_TRADE',note:'',name:rule.name || '',criterion:rule.criterion || '',checkpoint:rule.checkpoint || ''};
    // An add's observations never replace the original opening checks.
    if (newAssignment && preview.action!=='ADD') assignment = updateStrategyCheck(assignment,'pre',rule.id,status,'成交後登錄／確認',now);
  }
  const planHistory = [...(data.planHistory || [])];
  const plan = {...preview.plan};
  const references = {...plan.references};
  for (const field of ['stopLoss','takeProfit']) if (preview.after) {
    const raw = draft[field] ?? plan[field];
    const value = raw === '' || raw == null ? null : Number(raw);
    if (value !== (plan[field] ?? null)) {
      const version = {id:`entry-plan-${fill.id}-${field}`,cycleId,accountId:fill.accountId,symbol:fill.symbol,field,value,reason:String(draft.note || '成交後登錄計畫'),effectiveAt:now,createdAt:now,source:'POST_TRADE_ENTRY'};
      version.batchId=`entry-plan-${fill.id}`;
      version.previousValue=plan[field]??null;
      version.standardSnapshot=draft.standardSnapshot||null;
      planHistory.push(version); references[field]=version.id;
    }
    plan[field]=value;
    plan.sources={...plan.sources,[field]:draft.planModes?.[field]||'MANUAL'};
  }
  const evidenceMatches = draft.evidenceKey === entryEvidenceKey(draft);
  const evidence = buildEntryEvidence(evidenceMatches ? draft.evidenceBars : data.marketBars,fill.timestamp,fill.market,fill.symbol,evidenceMatches ? draft.evidenceFetchedAt : null,evidenceMatches ? draft.evidenceSource : '帳號既有日線');
  const valuation = entryValuation(data,preview,draft,snapshot);
  const stopBasis = draft.stopBasis === 'UNSET' && draft.stopLoss === undefined && positive(preview.plan?.stopLoss) ? 'ORIGINAL' : draft.stopBasis || 'UNSET';
  const targetBasis = draft.targetBasis === 'UNSET' && draft.takeProfit === undefined && positive(preview.plan?.takeProfit) ? 'ORIGINAL' : draft.targetBasis || 'UNSET';
  const pending = [];
  if (entryApplicable && !assignment) pending.push('主策略');
  if (draft.formatVersion!==2 && entryApplicable && (!draft.entrySetup || draft.entrySetup==='UNCLASSIFIED')) pending.push('進場型態');
  if (draft.formatVersion!==2 && entryApplicable && !(draft.volumeTags || []).length) pending.push('量價觀察');
  if (draft.formatVersion!==2 && preview.action==='ADD' && (!draft.addReason || draft.addReason==='PENDING')) pending.push('加碼理由');
  if (preview.after && !positive(plan.stopLoss)) pending.push('停損');
  if (preview.after && !positive(plan.takeProfit)) pending.push('停利');
  if (strategyStages.some(stage => !stage.versionSnapshot || stage.groups.some(group => group.status === 'PENDING'))) pending.push('策略條件');
  if (preview.after && stopBasis==='UNSET') pending.push('停損依據');
  if (preview.after && targetBasis==='UNSET') pending.push('停利依據');
  if (!evidence.complete) pending.push('十日行情');
  const context = {strategyStages,strategyFormatVersion:2,formatVersion:draft.formatVersion || 1,standardSnapshot:draft.standardSnapshot || null,fillId:fill.id,accountId:fill.accountId,symbol:fill.symbol,fillPrice:fill.price,fillFee:fill.fee,fillQuantity:fill.quantity,fillSide:fill.side,currency:fill.currency,cycleId,action:preview.action,fillTimestamp:fill.timestamp,recordedAt:now,source:'POST_TRADE',entrySetup:entryApplicable ? draft.entrySetup || 'UNCLASSIFIED' : null,volumeTags:entryApplicable ? [...(draft.volumeTags || [])] : [],addReason:preview.action==='ADD' ? draft.addReason || 'PENDING' : null,note:fill.note,stopBasis,targetBasis,ruleChecks:checks,strategyName:(data.strategies||[]).find(s=>s.id===assignment?.strategyId)?.name||null,strategyId:assignment?.strategyId || null,strategyVersionId:assignment?.strategyVersionId || null,planReferences:references,planSnapshot:{stopLoss:plan.stopLoss ?? null,takeProfit:plan.takeProfit ?? null,legacy:!!plan.legacy},evidence,valuation,before:preview.before ? {quantity:preview.before.quantity,averageCost:preview.before.averageCost,direction:preview.before.direction} : null,after:preview.after ? {quantity:preview.after.quantity,averageCost:preview.after.averageCost,direction:preview.after.direction} : null,originalUnrealizedAtFill:{currency:fill.currency,amount:preview.before ? (preview.before.direction==='SHORT'?-1:1)*(fill.price-preview.before.averageCost)*preview.before.quantity : null},pending};
  const stillOpen = buildCycles({fills:[...data.fills,fill],marketBars:[]}).positions.some((position)=>position.id===cycleId);
  const {entryDraft: _draft, ...rest} = data;
  void _draft;
  const changesPlan = planHistory.length !== (data.planHistory || []).length;
  const canUpdateCurrentPlan = stillOpen && preview.after && (!preview.historical || !data.positionPlans?.[cycleId]);
  return reconcileBackdatedCycles(data, {...rest,fills:[...data.fills,fill],entryContexts:{...(data.entryContexts || {}),[fill.id]:copy(context)},planHistory,positionPlans:canUpdateCurrentPlan && changesPlan ? {...(data.positionPlans || {}),[cycleId]:{...plan,references,updatedAt:now,source:'POST_TRADE_ENTRY'}} : data.positionPlans || {},strategyAssignments:newAssignment ? {...(data.strategyAssignments || {}),[cycleId]:assignment} : data.strategyAssignments || {}}, fill.id, now);
}
