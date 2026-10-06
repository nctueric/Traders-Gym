"use client";
import {createContext,useContext,useId,useLayoutEffect,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useMobileLayout} from './mobile-ui';
const Context=createContext<{active:string|null;setActive:(id:string|null)=>void}|null>(null);
export function InfoPopoverGroup({children}:{children:ReactNode}) {
 const [active,setActive]=useState<string|null>(null);
 return <Context.Provider value={{active,setActive}}>{children}</Context.Provider>;
}
function HelpSheet({id,label,children,onClose}:{id:string;label:string;children:ReactNode;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const closeRef=useRef(onClose);
 useLayoutEffect(()=>{closeRef.current=onClose;},[onClose]);
 useEffect(()=>{
  const node=dialog.current;if(!node)return;
  const previous=document.body.style.overflow;
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const cancel=(event:Event)=>{event.preventDefault();event.stopPropagation();closeRef.current();};
  const keyboard=(event:KeyboardEvent)=>{event.stopPropagation();if(event.key==='Escape')cancel(event);};
  const outside=(event:MouseEvent)=>{if(event.target!==node)return;const rect=node.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeRef.current();};
  node.addEventListener('cancel',cancel);node.addEventListener('keydown',keyboard);node.addEventListener('click',outside);
  node.showModal();document.body.style.overflow='hidden';node.querySelector<HTMLButtonElement>('button')?.focus();
  return()=>{node.removeEventListener('cancel',cancel);node.removeEventListener('keydown',keyboard);node.removeEventListener('click',outside);node.close();document.body.style.overflow=previous;if(opener?.isConnected)opener.focus({preventScroll:true});};
 },[]);
 return <dialog ref={dialog} id={id} className="mobile-help-sheet" aria-label={`${label}說明`}><header><h2>{label}</h2><button type="button" aria-label="關閉說明" onClick={onClose}>關閉</button></header><div className="mobile-help-content">{children}</div></dialog>;
}
export function InfoPopover({label,children,mobilePresentation='popover'}:{label:string;children:ReactNode;mobilePresentation?:'popover'|'sheet'}) {
 const id=useId(),ctx=useContext(Context),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [localOpen,setLocalOpen]=useState(false),[portalTarget,setPortalTarget]=useState<Element|null>(null);
 const mobile=useMobileLayout(),open=ctx?ctx.active===id:localOpen,sheet=mobile&&mobilePresentation==='sheet';
 const setOpen=(value:boolean)=>{if(ctx)ctx.setActive(value?id:null);else setLocalOpen(value);};
 const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};
 useEffect(()=>{if(!open)return;const other=(event:Event)=>{if((event as CustomEvent<string>).detail!==id){if(ctx)ctx.setActive(null);else setLocalOpen(false);}};document.addEventListener('tradergym:help-open',other);return()=>document.removeEventListener('tradergym:help-open',other);},[open,id,ctx]);
 useLayoutEffect(()=>{
  if(!open||sheet)return;
  const position=()=>{
   if(!button.current||!panel.current)return;
   const anchor=button.current.getBoundingClientRect(),box=panel.current;
   const left=Math.max(12,Math.min(anchor.left,window.innerWidth-box.offsetWidth-12));
   const below=anchor.bottom+8;
   const top=below+box.offsetHeight<=window.innerHeight-12?below:Math.max(12,anchor.top-box.offsetHeight-8);
   box.style.left=`${left}px`;box.style.top=`${top}px`;
  };
  const dismiss=()=>{if(ctx)ctx.setActive(null);else setLocalOpen(false);};
  const outside=(e:PointerEvent)=>{if(!button.current?.contains(e.target as Node)&&!panel.current?.contains(e.target as Node))dismiss();};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();button.current?.focus();}};
  position();const observer=new ResizeObserver(position);if(panel.current)observer.observe(panel.current);
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
 },[open,sheet,ctx]);
 return <><button ref={button} type="button" className="asset-info-trigger" aria-label={`${label}說明`} aria-expanded={open} aria-haspopup={sheet?'dialog':undefined} aria-controls={open?id:undefined} onClick={event=>{setPortalTarget(event.currentTarget.closest("dialog") || document.body);if(!open)document.dispatchEvent(new CustomEvent('tradergym:help-open',{detail:id}));setOpen(!open);}}><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 3 L12 8 L5 13 Z" fill="currentColor"/></svg></button>{open&&createPortal(sheet?<HelpSheet id={id} label={label} onClose={close}>{children}</HelpSheet>:<div ref={panel} id={id} className="asset-info-panel" role="region" aria-label={`${label}說明`}><strong>{label}</strong>{children}</div>,portalTarget || document.body)}</>;
}
