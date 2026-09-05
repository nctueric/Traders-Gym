"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Mount on first opening, then retain state while collapsed (chart range, plan edits). */
export function OverviewDisclosure({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [visited, setVisited] = useState(false);
  return <details className="overview-disclosure" onToggle={event => { if (event.currentTarget.open) setVisited(true); }}>
    <summary id={`${id}-label`} aria-controls={id}>{label}<span className="disclosure-action" aria-hidden="true"/></summary>
    {visited && <div id={id} role="region" aria-labelledby={`${id}-label`} className="overview-disclosure-body">{children}</div>}
  </details>;
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

/** Docked detail retains its children when collapsed or enlarged. No record state. */
export function DetailFrame({ label, className = "", onClose, children }: {
  label: string; className?: string; onClose: () => void; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const scrollY = window.scrollY;
    const narrow = window.matchMedia("(max-width:1199px)").matches;
    if (narrow) window.scrollTo({ top:0, behavior:"instant" });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll:true });
      if (narrow) window.scrollTo({ top:scrollY, behavior:"instant" });
    };
  }, []);
  useEffect(() => {
    const element = panel.current;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    element?.addEventListener("keydown", escape);
    return () => element?.removeEventListener("keydown", escape);
  }, [onClose]);
  return <section ref={panel} tabIndex={-1} aria-label={label}
    className={`workspace-detail ${className} ${expanded ? "is-expanded" : ""} ${collapsed ? "is-collapsed" : ""}`}>
    <div className="detail-tools">
      <button type="button" onClick={onClose}>返回清單</button>
      <span>{label}</span>
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? "展開詳情" : "收合詳情"}</button>
      <button type="button" className="detail-expand" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "還原雙欄" : "放大詳情"}</button>
    </div>
    <div className="detail-body" hidden={collapsed}>{children}</div>
  </section>;
}
