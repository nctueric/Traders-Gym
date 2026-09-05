// Presentation adapter only: all chart coordinates and financial values stay unchanged.
export function themedContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (typeof document === "undefined") return context;
  const styles = getComputedStyle(document.documentElement);
  const aliases: Record<string, string> = {
    "#53645c": "--muted", "#41564a": "--muted", "#56645e": "--muted",
    "#69766e": "--muted", "#7a8581": "--muted", "#d8e0db": "--line",
    "#e0e7e2": "--line", "#17211f": "--ink", "#168362": "--green",
    "#cb4848": "--red", "#3864b0": "--accent",
  };
  return new Proxy(context, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      if ((key === "fillStyle" || key === "strokeStyle") && typeof value === "string" && value.startsWith("#")) {
        const token = aliases[value] || `--tone-${value.slice(1).toLowerCase()}`;
        value = styles.getPropertyValue(token).trim() || value;
      }
      return Reflect.set(target, key, value, target);
    },
  });
}

export function observeChartTheme(draw: () => void) {
  if (typeof MutationObserver === "undefined") return { disconnect() {} };
  const observer = new MutationObserver(draw);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return observer;
}
