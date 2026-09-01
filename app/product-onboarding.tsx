"use client";

import { useState } from "react";

export const ONBOARDING_STEPS = [
  { title: "每天只先看三件事", copy: "「今日」會依資料阻擋、持倉風險與待復盤順序，最多挑三項需要你決定的事。", example: "先決定，再看完整數字" },
  { title: "提醒一定能回到證據", copy: "點擊風險提醒會直接打開原始持倉、停損計畫與 K 線，不會只給一句沒有出處的建議。", example: "提示 → 持倉 → 計畫" },
  { title: "用四步完成復盤", copy: "先確認事實，再做人工判斷、找出原因，最後只留一個可驗證的改善實驗。", example: "事實 → 判斷 → 原因 → 實驗" },
  { title: "缺資料就明確說不知道", copy: "資料檢查與交易計算分開；行情、匯率或事前停損缺漏時，系統不會推測補造。", example: "可驗證比看起來完整更重要" },
];

export function ProductOnboarding({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const item = ONBOARDING_STEPS[step];
  return <aside className="product-onboarding" aria-labelledby="onboarding-title">
    <div className="onboarding-progress" aria-label={`導覽第 ${step + 1} 步，共 ${ONBOARDING_STEPS.length} 步`}><span>{step + 1}/{ONBOARDING_STEPS.length}</span><div>{ONBOARDING_STEPS.map((_, index) => <i key={index} className={index <= step ? "active" : ""}/>)}</div></div>
    <div className="onboarding-copy"><p>新版使用導覽</p><h3 id="onboarding-title">{item.title}</h3><span>{item.copy}</span><b>{item.example}</b></div>
    <div className="onboarding-actions"><button type="button" className="text-button" onClick={onFinish}>略過導覽</button>{step > 0 && <button type="button" className="ghost" onClick={() => setStep((current) => current - 1)}>上一步</button>}<button type="button" className="primary" onClick={() => step === ONBOARDING_STEPS.length - 1 ? onFinish() : setStep((current) => current + 1)}>{step === ONBOARDING_STEPS.length - 1 ? "開始使用" : "下一步"}</button></div>
  </aside>;
}
