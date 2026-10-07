"use client";

import { useState } from "react";

export const ONBOARDING_STEPS = [
  {title:"建立帳本",copy:"每份帳本獨立保存成交、資金與策略。從帳本列可新增、切換，或從回收筒還原。",example:"先選定這次要記錄的帳本"},
  {title:"登錄資金",copy:"從持倉現金區或「成交與資金」新增入金，建立資金基準；股息、利息與費用也記錄在這裡。",example:"入出金不會被算作投資報酬"},
  {title:"新增交易",copy:"登錄已成交的股數、價格與時間，再確認策略和整筆持倉計畫。",example:"記錄真實成交，保留當時的判斷"},
  {title:"回到複盤",copy:"以行為分析、策略與閉環交易回顧結果，逐步改善自己的決策。",example:"記錄 → 複盤 → 持續練習"},
];

export function ProductOnboarding({ onFinish, multipleLedgers=false }: { onFinish: () => void; multipleLedgers?:boolean }) {
  const [step, setStep] = useState(0);
  const item = step===0&&!multipleLedgers?{title:"使用帳本",copy:"成交、資金與策略統一保存於你的雲端帳本，可在帳本頁更名、匯入及匯出。",example:"從登錄資金開始記錄"}:ONBOARDING_STEPS[step];
  return <aside className="product-onboarding" aria-labelledby="onboarding-title">
    <div className="onboarding-progress" aria-label={`導覽第 ${step + 1} 步，共 ${ONBOARDING_STEPS.length} 步`}><span>{step + 1}/{ONBOARDING_STEPS.length}</span><div>{ONBOARDING_STEPS.map((_, index) => <i key={index} className={index <= step ? "active" : ""}/>)}</div></div>
    <div className="onboarding-copy"><p>新版使用導覽</p><h3 id="onboarding-title">{item.title}</h3><span>{item.copy}</span><b>{item.example}</b></div>
    <div className="onboarding-actions"><button type="button" className="text-button" onClick={onFinish}>略過導覽</button>{step > 0 && <button type="button" className="ghost" onClick={() => setStep((current) => current - 1)}>上一步</button>}<button type="button" className="primary" onClick={() => step === ONBOARDING_STEPS.length - 1 ? onFinish() : setStep((current) => current + 1)}>{step === ONBOARDING_STEPS.length - 1 ? "開始使用" : "下一步"}</button></div>
  </aside>;
}
