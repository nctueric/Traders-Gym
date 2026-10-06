// Isolated visual harness: production components, memory-only callbacks, no account APIs.
import {createRoot} from 'react-dom/client';
import {CashEditor} from '../app/cash-ledger';
import {LedgerManager} from '../app/ledger-manager';
import {Brand} from '../app/brand';
import '../app/globals.css';
import '../app/account.css';
import '../app/workbench.css';
import '../app/mobile.css';
import '../app/form-controls.css';
const scenario=new URL(location.href).searchParams.get('scenario')||'cash';
const accounts=[{id:'fixture-account',name:'示範交易帳戶',currency:'USD'}];
const fetcher:typeof fetch=async()=>new Response(JSON.stringify({accounts:[{id:'one',name:'美股波段練習',version:1},{id:'two',name:'已結束的策略練習',version:3,deletedAt:'2026-09-25'}]}),{headers:{'Content-Type':'application/json'}});
createRoot(document.getElementById('root')!).render(<main className="auth-page"><section className="auth-panel"><Brand/><h1>隔離介面驗收</h1><p>此頁只有合成資料，不會保存。</p></section>{scenario.startsWith('ledger')?<LedgerManager fetcher={fetcher} beforeChange={async()=>{}} onChanged={()=>{}} onClose={()=>{}}/>:<CashEditor accounts={accounts} now="2026-09-25T08:00:00Z" activity={scenario.includes('invalid')?{id:'fixture-negative',type:'WITHDRAWAL',amount:-100,timestamp:'2026-09-25T08:00:00Z',accountId:'fixture-account',currency:'USD'}:undefined} onSave={async()=>{}} onClose={()=>{}}/>}</main>);
