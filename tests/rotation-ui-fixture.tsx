import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RotationContent} from '../app/rotation-workspace';
import {WorkspaceNavigation} from '../app/workspace-navigation';
import {DEFAULT_ROTATION,ROTATION_UNIVERSE} from '../lib/rotation-engine.mjs';
import '../app/globals.css';
import '../app/account.css';
import '../app/workbench.css';
import '../app/mobile.css';
import '../app/form-controls.css';
const snapshot=await (await fetch('/fixture.json')).json();
function Fixture(){
 const [open,setOpen]=useState(false),[active,setActive]=useState('rotation');
 const all=new URL(location.href).searchParams.has('all');
 const [preferences,setPreferences]=useState({rotation:{...DEFAULT_ROTATION,...(all?{tail:24,themes:ROTATION_UNIVERSE.filter(r=>r.kind==='theme').map(r=>r.symbol)}:{})}});
 return <div className="shell trading-workbench"><WorkspaceNavigation user={{name:'本機驗收',email:'fixture@example.test'}} demo={false} active={active} title="板塊輪動" open={open} onToggle={()=>setOpen(v=>!v)} onNavigate={setActive} onLogout={()=>{}}/><main className="content">{active==='rotation'?<RotationContent initialData={snapshot} preferences={{preferences,ready:true,update:async(patch:typeof preferences)=>{const response=await fetch('/fixture/preferences',{method:'POST',body:JSON.stringify(patch)});if(!response.ok)throw Error('驗收：設定儲存失敗');setPreferences(p=>({...p,...patch}));}}}/>:<button onClick={()=>setActive('rotation')}>回到板塊輪動</button>}</main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
