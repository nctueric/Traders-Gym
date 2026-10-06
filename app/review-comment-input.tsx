"use client";
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { createTextEditBuffer } from '@/lib/text-edit-buffer.mjs';
export type CommentHandle = { flush: () => void };
export function ReviewCommentInput({ value, onCommit, ref }: { value: string; onCommit: (value: string) => void; ref: Ref<CommentHandle> }) {
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => { commit.current = onCommit; }, [onCommit]);
  const buffer = useRef<ReturnType<typeof createTextEditBuffer> | null>(null);
  useEffect(() => {
    buffer.current = createTextEditBuffer(input.current?.value || "", (next: string) => commit.current(next));
    return () => buffer.current?.dispose();
  }, []);
  useImperativeHandle(ref, () => ({ flush: () => buffer.current?.flush() }), []);
  useEffect(() => { if (buffer.current?.receive(value) && input.current) input.current.value = value; }, [value]);
  useEffect(() => {
    const flush = () => buffer.current?.flush();
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); buffer.current?.dispose(); };
  }, []);
  return <label className="review-comment">評論<input ref={input} type="text" defaultValue={value} placeholder="記下這筆交易的觀察與評論…"
    onChange={event => buffer.current?.edit(event.target.value)}
    onCompositionStart={() => buffer.current?.composition(true)}
    onCompositionEnd={event => { buffer.current?.edit(event.currentTarget.value); buffer.current?.composition(false); }}
    onBlur={event => { buffer.current?.edit(event.currentTarget.value); buffer.current?.flush(); }} /></label>;
}
