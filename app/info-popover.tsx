"use client";
import {createContext,useContext,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
const Context=createContext<{active:string|null;setActive:(id:string|null)=>void}|null>(null);
export function InfoPopoverGroup({children}:{children:ReactNode}) {
 const [active,setActive]=useState<string|null>(null);
 return <Context.Provider value={{active,setActive}}>{children}</Context.Provider>;
}
export function InfoPopover({label,children}:{label:string;children:ReactNode}) {
 const id=useId(),ctx=useContext(Context),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const open=ctx?.active===id;
 useLayoutEffect(()=>{
  if(!open)return;
  const position=()=>{
   if(!button.current||!panel.current)return;
   const anchor=button.current.getBoundingClientRect(),box=panel.current;
   const left=Math.max(12,Math.min(anchor.left,window.innerWidth-box.offsetWidth-12));
   const below=anchor.bottom+8;
   const top=below+box.offsetHeight<=window.innerHeight-12?below:Math.max(12,anchor.top-box.offsetHeight-8);
   box.style.left=`${left}px`;box.style.top=`${top}px`;
  };
  const outside=(e:PointerEvent)=>{if(!button.current?.contains(e.target as Node)&&!panel.current?.contains(e.target as Node))ctx?.setActive(null);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();ctx?.setActive(null);button.current?.focus();}};
  position();const observer=new ResizeObserver(position);if(panel.current)observer.observe(panel.current);
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
 },[open,ctx]);
 return <><button ref={button} type="button" className="asset-info-trigger" aria-label={`${label}說明`} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>ctx?.setActive(open?null:id)}><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 3 L12 8 L5 13 Z" fill="currentColor"/></svg></button>{open&&createPortal(<div ref={panel} id={id} className="asset-info-panel" role="region" aria-label={`${label}說明`}><strong>{label}</strong>{children}</div>,document.body)}</>;
}
