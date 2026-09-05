"use client";

import { useSyncExternalStore } from "react";

const preferenceKey = "traders-gym:appearance";
function snapshot() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const sync = (event: StorageEvent) => {
    if (event.key === preferenceKey || event.key === null) {
      document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    }
  };
  window.addEventListener("storage", sync);
  return () => { observer.disconnect(); window.removeEventListener("storage", sync); };
}

export function ThemeToolbar() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark");
  function choose(value: "dark" | "light") {
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem(preferenceKey, value); } catch { /* Device preference is optional; switching still works. */ }
  }
  return <div className="appearance-toolbar"><div role="group" aria-label="介面外觀">
    <span>外觀</span>
    <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>淺色</button>
    <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>深色</button>
  </div></div>;
}
