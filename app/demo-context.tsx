"use client";
import {createContext,useContext} from 'react';
import type {createDemoRuntime} from '@/lib/demo-workspace.mjs';
export const DemoContext=createContext<ReturnType<typeof createDemoRuntime>|null>(null);
export const useDemoRuntime=()=>useContext(DemoContext);
