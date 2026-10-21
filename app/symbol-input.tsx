"use client";
import {useEffect, useRef, type InputHTMLAttributes} from 'react';
import {flushSync} from 'react-dom';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> & {
 value: string;
 onCommit: (symbol: string) => void;
};

// Native editing stays independent of ledger serialization and valuation renders.
// Commit on idle or blur, before a following button click can inspect the draft.
export function SymbolInput({value, onCommit, ...props}: Props) {
 const input = useRef<HTMLInputElement>(null);
 const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const pending = useRef(false), composing = useRef(false);
 const callback = useRef(onCommit);
 useEffect(() => { callback.current = onCommit; }, [onCommit]);
 useEffect(() => {
  const element = input.current;
  if (element && !pending.current && !composing.current && element.value.trim().toUpperCase() !== value) element.value = value;
 }, [value]);
 useEffect(() => () => clearTimeout(timer.current), []);
 const commit = () => {
  clearTimeout(timer.current);
  if (!pending.current || composing.current || !input.current) return false;
  pending.current = false;
  const symbol = input.current.value.trim().toUpperCase();
  if (symbol !== value) callback.current(symbol);
  return true;
 };
 const schedule = () => {
  pending.current = true;
  clearTimeout(timer.current);
  if (!composing.current) timer.current = setTimeout(commit, 400);
 };
 return <input {...props} ref={input} defaultValue={value} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
  onChange={schedule}
  onCompositionStart={() => {composing.current = true; clearTimeout(timer.current);}}
  onCompositionEnd={() => {composing.current = false; schedule();}}
  onBlur={() => {
   composing.current = false;
   flushSync(() => {commit();});
   if (input.current) input.current.value = input.current.value.trim().toUpperCase();
  }}
  onKeyDown={event => {
   if (event.key !== 'Enter') return;
   if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {event.preventDefault(); return;}
   // Never submit a preview for the previous symbol in the same key event.
   if (pending.current) {event.preventDefault(); flushSync(() => {commit();});}
  }}/ >;
}
