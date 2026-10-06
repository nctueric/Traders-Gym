"use client";

import { useMobileLayout } from "./mobile-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Mount on first opening, then retain state while collapsed (chart range, plan edits). */
export function OverviewDisclosure({ id, label, children, mobileDefaultOpen=false }: { id: string; label: string; children: ReactNode; mobileDefaultOpen?: boolean }) {
  const [visited, setVisited] = useState(false);
  const mobile=useMobileLayout(),[selection,setSelection]=useState<boolean|null>(null);
  const open=selection ?? (mobileDefaultOpen&&mobile);
  return <details className="overview-disclosure" open={open} onToggle={event => { if (event.currentTarget.open) setVisited(true); }}>
    <summary id={`${id}-label`} aria-controls={id} onClick={event=>{event.preventDefault();setSelection(!open);if(!open)setVisited(true);}}>{label}<span className="disclosure-action" aria-hidden="true"/></summary>
    {(visited || open) && <div id={id} role="region" aria-labelledby={`${id}-label`} className="overview-disclosure-body">{children}</div>}
  </details>;
}

/** Inactive panels stay mounted so filters, drafts and chart selection survive switching. */
export function WorkspaceTabs({label,items}:{label:string;items:{id:string;label:string;content:ReactNode}[]}) {
 const [active,setActive]=useState(items[0].id);
 const tabs=useRef<(HTMLButtonElement|null)[]>([]);
 return <><div className="workspace-tabs" role="tablist" aria-label={label}>
  {items.map((item,index)=><button type="button" role="tab" id={`${item.id}-tab`} key={item.id} ref={node=>{tabs.current[index]=node;}} aria-controls={item.id} aria-selected={active===item.id} tabIndex={active===item.id?0:-1} onClick={()=>setActive(item.id)} onKeyDown={event=>{
   const next=event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;
   if(next===null)return;event.preventDefault();setActive(items[next].id);tabs.current[next]?.focus();
  }}>{item.label}</button>)}
 </div>{items.map(item=><section key={item.id} role="tabpanel" id={item.id} aria-labelledby={`${item.id}-tab`} hidden={active!==item.id} tabIndex={0} className="analysis-section">{item.content}</section>)}</>;
}

/** Native modal: focus containment, inert background, Escape and return focus. */
export function DialogFrame({ label, className = "", onClose, children }: {
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    dialog.querySelector<HTMLElement>(".close, button, input, select, textarea, a[href]")?.focus();
    const header = dialog.querySelector<HTMLElement>(".detail-header, .dialog-header");
    const resize = new ResizeObserver(() => {
      if (header) dialog.style.setProperty("--dialog-header-height", header.getBoundingClientRect().height + "px");
    });
    if (header) {
      dialog.style.setProperty("--dialog-header-height", header.getBoundingClientRect().height + "px");
      resize.observe(header);
    }
    document.body.style.overflow = "hidden";
    return () => {
      resize.disconnect();
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className={`workspace-dialog ${className}`} aria-label={label}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== "Tab") return;
      const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')]
        .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = stops[0];
      const last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {children}
  </dialog>;
}

export function SectionLinks({ label, links }: {
  label: string;
  links: { id: string; label: string }[];
}) {
  return <nav className="section-links" aria-label={label}>
    {links.map((link) => <a key={link.id} href={`#${link.id}`} onClick={(event) => {
      const target = document.getElementById(link.id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ block: "start", behavior: "instant" });
      target.focus({ preventScroll: true });
    }}>{link.label}</a>)}
  </nav>;
}
