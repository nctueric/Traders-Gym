"use client";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';

export function useMobileLayout() {
 const [mobile,setMobile]=useState(false);
 useEffect(()=>{const query=window.matchMedia('(max-width: 639px)');const update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 return mobile;
}
/** The same mounted content stays alive when changing viewport or disclosure state. */
export function MobileDetails({label,children,className=''}:{label:ReactNode;children:ReactNode;className?:string}) {
 const mobile=useMobileLayout(),[expanded,setExpanded]=useState(false);
 return <details className={`mobile-details ${className}`} open={!mobile||expanded} onToggle={event=>{if(mobile)setExpanded(event.currentTarget.open);}}><summary>{label}</summary>{children}</details>;
}

/** Fit complete values within their column; never abbreviate or shrink below body size. */
export function FitNumber({children,className=''}:{children:string|number;className?:string}) {
 const root=useRef<HTMLSpanElement>(null),text=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const box=root.current,content=text.current;if(!box||!content)return;
  let frame=0;
  const fit=()=>{
   const available=box.clientWidth;if(!available)return;
   content.style.fontSize='1em';
   const size=parseFloat(getComputedStyle(box).fontSize);
   const minimum=parseFloat(getComputedStyle(document.documentElement).fontSize);
   const width=content.getBoundingClientRect().width;
   content.style.fontSize=`${Math.min(1,Math.max(minimum/size,available/Math.max(width,1)))}em`;
   const overflow=content.getBoundingClientRect().width>available+1;
   box.tabIndex=overflow?0:-1;
   box.classList.toggle('number-overflow',overflow);
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(fit);};
  const observer=new ResizeObserver(schedule);observer.observe(box);
  window.addEventListener('resize',schedule);fit();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);};
 },[children]);
 return <span ref={root} className={`fit-number ${className}`}><span ref={text}>{children}</span></span>;
}
