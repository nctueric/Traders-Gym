"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { MATRIX_LEGENDS, matrixAmplitudeRatio, matrixDifference, matrixEqualitySegment, matrixPercentagePoints, matrixSharedY, matrixReferenceLabels, matrixBoxZoom, matrixCoordinates, matrixDomains, matrixGeometry, matrixPercent, matrixTicks, matrixVisible, nearbyMatrixPoints, zoomMatrix } from "@/lib/behavior-matrix.mjs";

type Kind = "mfeReturn" | "maeReturn";
type Point = {
  cycleId: string; symbol: string; direction: string; openAt: string; closeAt: string;
  mfePct: number | null; maePct: number | null; returnPct: number | null; retention: number | null;
  category: string; reason?: string;
};
type Domains = { x: number[]; y: number[] };
type Pixel = { x: number; y: number };
type Data = { mfeReturn: Point[]; maeReturn: Point[]; mfeReturnExcluded: Point[]; maeReturnExcluded: Point[] };
const CONFIG = {
  mfeReturn: { title: "MFE 報酬矩陣", question: "曾有多少獲利空間，最後實現多少？", xLabel: "最大順向波動 MFE（%）", yLabel: "實際交易損益率（%）", xShort: "MFE", yShort: "損益率" },
  maeReturn: { title: "MAE 報酬矩陣", question: "曾承受多少逆向波動，最後賺或賠？", xLabel: "最大逆向波動 MAE（%）", yLabel: "實際交易損益率（%）", xShort: "MAE", yShort: "損益率" },
};
const date = (value: string) => value?.slice(0, 10) || "日期未提供";
const direction = (point: Point) => point.direction === "SHORT" ? "空" : point.direction === "LONG" ? "多" : "方向未提供";
const name = (point: Point) => `${point.symbol}・${direction(point)}・${date(point.openAt)} → ${date(point.closeAt)}`;
function legendFor(point: Point) { return MATRIX_LEGENDS.find(item => item.key === point.category); }

function Mark({ shape }: { shape: string }) {
  if (shape === "triangle") return <path d="M 0 -7 L 7 6 L -7 6 Z"/>;
  if (shape === "diamond") return <path d="M 0 -7 L 7 0 L 0 7 L -7 0 Z"/>;
  return <circle r="6"/>;
}
function LegendMark({ shape, tone }: { shape: string; tone: string }) {
  return <svg viewBox="-10 -10 20 20" className={`matrix-mark ${tone}`} aria-hidden="true"><Mark shape={shape}/></svg>;
}
function interpretation(point: Point, kind: Kind) {
  if (point.reason) return point.reason + "；可開啟復盤查看原始交易。";
  const difference = matrixDifference(point, kind);
  if (difference == null) return "差距超出可計算範圍；仍依原始數值呈現。";
  if (Math.abs(difference) < 1e-12) return `實際損益率與 ${kind === "mfeReturn" ? "MFE" : "MAE"} 參考值相等，位於等值線上。`;
  const distance = matrixPercentagePoints(Math.abs(difference), false);
  if (kind === "mfeReturn") {
    if (difference < 0) return `實際損益率高於 MFE ${distance}，位於等值線上方；需配合加減碼與行情計算方式解讀。`;
    if (point.mfePct! > 0 && point.returnPct! < 0) return `曾有 ${matrixPercent(point.mfePct)} 的順向獲利空間，最終虧損 ${matrixPercent(Math.abs(point.returnPct!))}，屬於浮盈轉虧；與 MFE 相差 ${distance}。`;
    return `實際損益率低於 MFE ${distance}，位於等值線下方。${point.returnPct! > 0 ? "最終獲利，但實現報酬小於曾有的順向波動。" : "請配合原始交易與日線近似解讀。"}`;
  }
  if (difference > 0) return `最終損益率比 MAE 高 ${distance}，位於等值線上方；這是數值比較，不代表是否遵守原策略。`;
  return `最終損益率比 MAE 低 ${distance}，位於等值線下方；請核對費用、加減碼與行情覆蓋，不能直接判定資料錯誤。`;
}

export function BehaviorMatrices({ data, onSelectCycle }: { data: Data; onSelectCycle: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sharedY = useMemo(() => matrixSharedY(data), [data]);
  return <div className="behavior-grid matrix-grid">
    {(["mfeReturn", "maeReturn"] as Kind[]).map(kind => <MatrixChart key={kind} kind={kind} sharedY={sharedY} points={data[kind]} excluded={kind === "mfeReturn" ? data.mfeReturnExcluded : data.maeReturnExcluded} selectedId={selectedId} onSelect={setSelectedId} onSelectCycle={onSelectCycle}/>)}
  </div>;
}

function MatrixChart({ kind, points, excluded, sharedY, selectedId, onSelect, onSelectCycle }: {
  kind: Kind; points: Point[]; excluded: Point[]; sharedY: number[]; selectedId: string | null;
  onSelect: (id: string | null) => void; onSelectCycle: (id: string) => void;
}) {
  const config = CONFIG[kind];
  const id = useId().replace(/:/g, "");
  const article = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pointer = useRef<{ start: Pixel; client: Pixel; touch: boolean; moved: boolean } | null>(null);
  const [width, setWidth] = useState(640);
  const [zoom, setZoom] = useState<Domains | null>(null);
  const [showAmplitude, setShowAmplitude] = useState(false);
  const [zoomMode, setZoomMode] = useState(false);
  const [box, setBox] = useState<{ start: Pixel; end: Pixel } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Point[]>([]);
  const height = width < 500 ? 320 : 360;
  const full = useMemo(() => matrixDomains(points, kind, sharedY), [points, kind, sharedY]);
  const domains = zoom || full;
  const xTicks = matrixTicks(domains.x, width < 500 ? 4 : 7);
  const yTicks = matrixTicks(domains.y, width < 500 ? 5 : 7);
  const digits = (range: number[]) => Math.min(6, Math.max(0, Math.ceil(-Math.log10((range[1] - range[0]) * 100 / 6))));
  const xDigits = digits(domains.x), yDigits = digits(domains.y);
  const left = Math.max(58, ...yTicks.map(value => matrixPercent(value, yDigits).length * 7 + 14));
  const geometry = matrixGeometry(domains, width, height, left);
  const visible = points.filter(point => matrixVisible(point, kind, domains));
  const all = [...points, ...excluded].sort((a, b) => String(b.closeAt).localeCompare(String(a.closeAt)) || String(a.cycleId).localeCompare(String(b.cycleId)));
  const selected = all.find(point => point.cycleId === selectedId);
  const selectedValue = selected && !selected.reason ? matrixCoordinates(selected, kind) : null;
  const difference = selected ? matrixDifference(selected, kind) : null;
  const amplitudeRatio = selected ? matrixAmplitudeRatio(selected) : null;
  const equality = matrixEqualitySegment(domains);
  const amplitude = showAmplitude ? matrixEqualitySegment(domains, true) : null;
  const hovered = visible.find(point => point.cycleId === hoverId);
  const hoverValue = hovered && matrixCoordinates(hovered, kind);
  const keyboardPoints = [...visible].sort((a, b) => String(a.closeAt).localeCompare(String(b.closeAt)) || String(a.cycleId).localeCompare(String(b.cycleId)));

  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => { setWidth(Math.max(240, entry.contentRect.width)); setBox(null); pointer.current = null; });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  const pixel = (event: PointerEvent<SVGSVGElement>): Pixel => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
  };
  const cancelBox = () => { pointer.current = null; setBox(null); };
  const reset = () => { setZoom(null); setZoomMode(false); setHoverId(null); setCandidates([]); cancelBox(); };
  const choose = (point: Point) => { onSelect(point.cycleId); setCandidates([]); setHoverId(null); };
  const applyBox = (start: Pixel, end: Pixel) => {
    const next = matrixBoxZoom(geometry, start, end);
    if (next) { setZoom(next); setZoomMode(false); setHoverId(null); setCandidates([]); }
    cancelBox();
  };
  const scale = (factor: number) => {
    const pivot = hovered || (selected && !selected.reason ? selected : null);
    setZoom(zoomMatrix(domains, full, factor, pivot ? matrixCoordinates(pivot, kind) : undefined));
    setHoverId(null); setCandidates([]); cancelBox(); setZoomMode(false);
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const position = pixel(event);
    if (!geometry.contains(position.x, position.y)) return;
    pointer.current = { start: position, client: { x: event.clientX, y: event.clientY }, touch: event.pointerType === "touch", moved: false };
    if (zoomMode && event.pointerType !== "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setBox({ start: position, end: position });
    }
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const position = pixel(event);
    const active = pointer.current;
    if (active && Math.hypot(event.clientX - active.client.x, event.clientY - active.client.y) > 8) active.moved = true;
    if (zoomMode) {
      if (box && event.pointerType !== "touch") setBox({ ...box, end: position });
      return;
    }
    if (event.pointerType === "touch") return;
    const nearby = geometry.contains(position.x, position.y) ? nearbyMatrixPoints(visible, kind, geometry, position) : [];
    setHoverId(nearby[0]?.cycleId || null);
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const active = pointer.current;
    if (!active) return;
    pointer.current = null;
    const position = pixel(event);
    if (zoomMode) {
      if (!active.touch) applyBox(active.start, position);
      else if (!active.moved && geometry.contains(position.x, position.y)) {
        if (box) applyBox(box.start, position);
        else setBox({ start: position, end: position });
      }
      return;
    }
    if (active.moved || !geometry.contains(position.x, position.y)) return;
    const nearby = nearbyMatrixPoints(visible, kind, geometry, position, active.touch ? 24 : 18);
    if (nearby.length > 1) { setCandidates(nearby); setHoverId(null); }
    else if (nearby.length === 1) choose(nearby[0]);
    else { setCandidates([]); setHoverId(null); }
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      if (!keyboardPoints.length) return;
      const index = keyboardPoints.findIndex(point => point.cycleId === (hoverId || selectedId));
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      setHoverId(keyboardPoints[(index < 0 ? (forward ? 0 : keyboardPoints.length - 1) : (index + (forward ? 1 : -1) + keyboardPoints.length) % keyboardPoints.length)].cycleId);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (hovered) choose(hovered);
      else if (keyboardPoints[0]) choose(keyboardPoints[0]);
    } else if (event.key === "+" || event.key === "=") { event.preventDefault(); scale(0.5); }
    else if (event.key === "-") { event.preventDefault(); scale(2); }
    else if (event.key === "Home") { event.preventDefault(); reset(); }
  };
  useEffect(() => {
    const element = article.current;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (zoomMode) { setZoomMode(false); setBox(null); pointer.current = null; }
      else { setCandidates([]); setHoverId(null); onSelect(null); }
    };
    element?.addEventListener("keydown", handleEscape);
    return () => element?.removeEventListener("keydown", handleEscape);
  }, [zoomMode, onSelect]);
  const label = (point: Point) => legendFor(point)?.label || "無法繪製";
  const horizontalReferences = [{ value: 0, label: "0% 損益分界" }];

  return <article className="matrix-chart" data-matrix-kind={kind} ref={article} aria-labelledby={id + "-title"}>
    <header><h3 id={id + "-title"}>{config.title}</h3><p>{config.question}</p></header>
    <div className="matrix-toolbar">
      <span className="matrix-count">有效 {points.length} 筆・無法繪製 {excluded.length} 筆</span>
      <div><button type="button" className="ghost" aria-pressed={zoomMode} disabled={!points.length} onClick={() => { setZoomMode(!zoomMode); setHoverId(null); setCandidates([]); cancelBox(); }}>{zoomMode ? "取消框選" : "框選放大"}</button><button type="button" className="ghost" disabled={!zoom && !zoomMode} onClick={reset}>還原全貌</button></div>
    </div>
    <div className="matrix-viewport-note" aria-live="polite">{zoomMode ? (box ? "選取另一個角落完成放大；Esc 取消。" : "桌面拖曳框選；手機依序點兩個角落。") : zoom ? `局部放大・視窗內 ${visible.length}／有效 ${points.length} 筆・視窗外 ${points.length - visible.length} 筆` : "全貌・兩圖共用損益率刻度"}</div>
    <div className="matrix-line-controls">
      <span className="matrix-line-key"><svg viewBox="0 0 28 12" aria-hidden="true"><line className="matrix-equality" x1="0" y1="6" x2="28" y2="6"/></svg>等值線 Y＝X{!equality && points.length > 0 ? "（視窗外）" : ""}</span>
      {kind === "maeReturn" && <label><input type="checkbox" checked={showAmplitude} onChange={event => setShowAmplitude(event.target.checked)}/><svg viewBox="0 0 28 12" aria-hidden="true"><line className="matrix-amplitude" x1="0" y1="6" x2="28" y2="6"/></svg>獲利＝逆向幅度</label>}
    </div>
    <div className="matrix-canvas-wrap" ref={host}>
      {points.length > 0 ? <svg ref={svg} className={`matrix-canvas ${zoomMode ? "zoom-mode" : ""}`} viewBox={`0 0 ${width} ${height}`} data-y-min={domains.y[0]} data-y-max={domains.y[1]} role="group" aria-label={config.title + "互動圖表"} aria-describedby={id + "-keys"} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={cancelBox} onPointerLeave={() => setHoverId(null)} onBlur={() => setHoverId(null)}>
        <defs><clipPath id={id + "-clip"}><rect x={geometry.left} y={geometry.top} width={geometry.right - geometry.left} height={geometry.bottom - geometry.top}/></clipPath></defs>
        <text className="matrix-axis-title" x={geometry.left} y={19}>{config.yLabel}</text>
        {xTicks.map(value => <g key={"x" + value}><line className="matrix-gridline" x1={geometry.x(value)} x2={geometry.x(value)} y1={geometry.top} y2={geometry.bottom}/><text className="matrix-tick" x={geometry.x(value)} y={geometry.bottom + 21} textAnchor="middle">{matrixPercent(value, xDigits)}</text></g>)}
        {yTicks.map(value => <g key={"y" + value}><line className="matrix-gridline" y1={geometry.y(value)} y2={geometry.y(value)} x1={geometry.left} x2={geometry.right}/><text className="matrix-tick" x={geometry.left - 9} y={geometry.y(value) + 4} textAnchor="end">{matrixPercent(value, yDigits)}</text></g>)}
        <path className="matrix-axis" d={`M ${geometry.left} ${geometry.top} V ${geometry.bottom} H ${geometry.right}`}/>
        <text className="matrix-axis-title" x={(geometry.left + geometry.right) / 2} y={height - 8} textAnchor="middle">{config.xLabel}</text>
        <g clipPath={`url(#${id}-clip)`}>
          {horizontalReferences.map(ref => <line key={ref.value} data-reference={ref.value} className={ref.value === 0 ? "matrix-zero" : "matrix-reference"} x1={geometry.left} x2={geometry.right} y1={geometry.y(ref.value)} y2={geometry.y(ref.value)}/>)}
          <line className="matrix-zero" x1={geometry.x(0)} x2={geometry.x(0)} y1={geometry.top} y2={geometry.bottom}/>
          {kind === "maeReturn" && <line className="matrix-reference" data-reference="-0.1" x1={geometry.x(-0.1)} x2={geometry.x(-0.1)} y1={geometry.top} y2={geometry.bottom}/>}
          {equality && <line className="matrix-equality" data-guide="equality" x1={geometry.x(equality.start.x)} y1={geometry.y(equality.start.y)} x2={geometry.x(equality.end.x)} y2={geometry.y(equality.end.y)}/>}
          {amplitude && <line className="matrix-amplitude" data-guide="amplitude" x1={geometry.x(amplitude.start.x)} y1={geometry.y(amplitude.start.y)} x2={geometry.x(amplitude.end.x)} y2={geometry.y(amplitude.end.y)}/>}
          {selectedValue && <g className="matrix-projection">
            <line data-guide="difference" x1={geometry.x(selectedValue.x)} x2={geometry.x(selectedValue.x)} y1={geometry.y(selectedValue.y)} y2={geometry.y(selectedValue.x)}/>
            {geometry.contains(geometry.x(selectedValue.x), geometry.y(selectedValue.x)) && <circle data-guide="projection-endpoint" cx={geometry.x(selectedValue.x)} cy={geometry.y(selectedValue.x)} r="4"/>}
          </g>}
          {visible.map(point => {
            const value = matrixCoordinates(point, kind);
            const legend = legendFor(point)!;
            const highlighted = point.cycleId === selectedId || point.cycleId === hoverId;
            return <g key={point.cycleId} data-cycle-id={point.cycleId} className={`matrix-dot ${legend.tone} ${point.cycleId === selectedId ? "selected" : ""}`} transform={`translate(${geometry.x(value.x)},${geometry.y(value.y)})`}>
              {highlighted && <circle r="11" className="matrix-selection-ring"/>}<Mark shape={legend.shape}/>
            </g>;
          })}
          {box && <g className="matrix-zoom-box"><rect x={Math.min(box.start.x, box.end.x)} y={Math.min(box.start.y, box.end.y)} width={Math.abs(box.end.x - box.start.x)} height={Math.abs(box.end.y - box.start.y)}/><circle cx={box.start.x} cy={box.start.y} r="4"/></g>}
        </g>
        {matrixReferenceLabels(horizontalReferences.map(ref => ref.value), geometry).map((ref: { value: number; y: number; labelY: number }) => <g key={ref.value} className="matrix-guide-caption"><path d={`M ${geometry.right} ${ref.y} L ${geometry.right + 9} ${ref.labelY} H ${geometry.right + 12}`}/><text x={geometry.right + 15} y={ref.labelY + 4}>{matrixPercent(ref.value, 0)}</text></g>)}
        {kind === "maeReturn" && geometry.x(-0.1) >= geometry.left && geometry.x(-0.1) <= geometry.right && <text className="matrix-reference-label" x={geometry.x(-0.1)} y={geometry.top - 7} textAnchor="middle">−10% 參考</text>}
      </svg> : <div className="matrix-empty"><b>此範圍尚無可繪製樣本</b><span>{excluded.length ? "展開樣本明細可查看缺資料原因。" : "可調整上方期間或策略篩選。"}</span></div>}
      {hovered && hoverValue && !zoomMode && <div className="matrix-tooltip" style={{ left: Math.min(Math.max(8, geometry.x(hoverValue.x) - 110), width - 228), top: Math.max(0, geometry.y(hoverValue.y) - 85) }}><b>{hovered.symbol}・{direction(hovered)}</b><span>{date(hovered.openAt)} → {date(hovered.closeAt)}</span><span>{config.xShort} {matrixPercent(hoverValue.x, 2)}・{config.yShort} {matrixPercent(hoverValue.y, 2)}</span></div>}
    </div>
    <div className="matrix-legend" aria-label={config.title + "分類圖例"}>{MATRIX_LEGENDS.map(item => <span key={item.key}><LegendMark shape={item.shape} tone={item.tone}/>{item.label}<b>{points.filter(point => point.category === item.key).length} 筆</b></span>)}</div>
    <p className="matrix-reference-note">等值線：實際損益率＝{config.xShort}。0% 水平線區分盈虧。{kind === "maeReturn" ? "−10% MAE 為觀察參考。" : ""}參考線不代表策略合格標準。{zoom ? "圖例筆數依完整篩選樣本計算。" : ""}</p>
    {kind === "maeReturn" && showAmplitude && <p className="matrix-amplitude-note">幅度線 Y＝−X：獲利等於逆向波動幅度；僅限 MAE≤0、損益率≥0。這是事後比較，不是事前風險報酬比或 R 倍數。{!amplitude ? "此線目前在視窗外。" : ""}</p>}
    {candidates.length > 0 && <div className="matrix-candidates" role="group" aria-label="重疊交易候選"><b>附近有 {candidates.length} 筆交易，選擇要查看的一筆</b>{candidates.map(point => <button type="button" key={point.cycleId} onClick={() => choose(point)}>{name(point)}<small>{config.xShort} {matrixPercent(matrixCoordinates(point, kind).x, 2)}・{config.yShort} {matrixPercent(matrixCoordinates(point, kind).y, 2)}</small></button>)}</div>}
    {selected ? <section className="matrix-selection" aria-label={config.title + "交易摘要"} aria-live="polite">
      <div className="matrix-selection-head"><div><b>{selected.symbol}・{direction(selected)}</b><span>{date(selected.openAt)} → {date(selected.closeAt)}</span></div><button type="button" className="text-button" onClick={() => onSelectCycle(selected.cycleId)}>開啟復盤</button><button type="button" className="ghost" aria-label="關閉交易摘要" onClick={() => { onSelect(null); setHoverId(null); }}>關閉</button></div>
      <dl>{[["損益率", selected.returnPct], ["MFE", selected.mfePct], ["MAE", selected.maePct], ["留存率", selected.retention]].map(([title, value]) => <div key={String(title)}><dt>{title}</dt><dd>{matrixPercent(value, 2)}</dd></div>)}</dl>
      <div className="matrix-difference"><span>{kind === "mfeReturn" ? "與 MFE 差距" : "相對 MAE 差距"}</span><strong>{matrixPercentagePoints(difference)}</strong><small>{kind === "mfeReturn" ? "MFE − 實際損益率" : "實際損益率 − MAE"}</small></div>
      {kind === "maeReturn" && showAmplitude && <div className="matrix-difference"><span>獲利／逆向幅度</span><strong>{amplitudeRatio == null ? "—" : `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(amplitudeRatio)} 倍`}</strong><small>{amplitudeRatio == null ? "須 MAE<0 且實際損益率>0；MAE 為 0 不計算比值。" : "實際損益率 ÷ MAE 絕對值；事後幅度比較。"}</small></div>}
      <p>{interpretation(selected, kind)}</p>
      {selected.retention == null && <p className="matrix-retention-note">留存率僅於 MFE 大於 0 且比值有效時顯示，不影響此圖繪製。</p>}
      {!selected.reason && !matrixVisible(selected, kind, domains) && <p>此筆交易在目前視窗外，可按「還原全貌」查看位置。</p>}
    </section> : <p className="matrix-selection-hint">點選交易查看數值與解讀；也可從下方樣本明細選取。</p>}
    <span className="sr-only" aria-live="polite">{hovered ? name(hovered) + `，${config.xShort} ${matrixPercent(hoverValue!.x)}，${config.yShort} ${matrixPercent(hoverValue!.y)}` : ""}</span>
    <details className="matrix-help"><summary>如何閱讀與操作</summary>
      {kind === "mfeReturn" ? <><p>等值線 Y＝X 代表實際損益率與 MFE 相等。線下但仍獲利，表示實現報酬小於順向波動；MFE 大於 0 而最終虧損，屬於浮盈轉虧。線上方的交易需配合加減碼與行情計算方式解讀。</p><p>與 MFE 差距＝MFE − 實際損益率，以百分點表示。例如 MFE 20%、實際損益率 8%，相差 12 個百分點；摘要中的留存率為 8% ÷ 20%＝40%。MFE 為零或負值仍可繪圖，留存率則不計算。</p></> : <><p>等值線 Y＝X 代表實際損益率與 MAE 相等。線上方是最終損益率高於 MAE，線下方則較低；線下方交易須配合費用、加減碼及行情覆蓋解讀，不直接判定為錯誤。</p><p>相對 MAE 差距＝實際損益率 − MAE。例如 MAE −10%、最終 −4%，高出 6 個百分點。MAE −10%、最終 +12%，高出 22 個百分點。</p><p>勾選「獲利＝逆向幅度」可顯示 Y＝−X 的非負報酬部分。MAE −10%、獲利 10% 在此線上；獲利 12% 位於線上方，獲利／逆向幅度為 1.2 倍。這是事後幅度比較，不是事前風險報酬比或 R 倍數。</p></>}
      <p>兩圖全貌共用縱軸刻度，放大後各自呈現局部範圍。等值線依真實數值座標繪製，不固定為視覺上的 45 度。選取交易的細垂直線表示與等值線的差距；超出視窗的部分只裁切，不把端點移到邊界。</p>
      <p>實際交易損益率＝扣除已登錄費用的交易損益 ÷ 全部進場金額。MFE／MAE 以持有期間日線高低價相對平均進場成本、依多空方向計算，屬日線近似；加減碼時，留存率不等同帳戶實際最高浮盈的保留比例。原始日線 MAE 若為正值，也不強制改為零。</p>
      <p id={id + "-keys"}>圖表聚焦後：方向鍵選樣本、Enter 查看摘要、+／− 放大或縮小、Home 還原全貌、Escape 取消框選或關閉摘要。手機一般模式可垂直捲頁。</p>
    </details>
    <details className="matrix-data"><summary>檢視 {all.length} 筆樣本明細與缺資料原因</summary><div className="table-wrap" tabIndex={0} role="region" aria-label={config.title + "樣本明細"}><table><thead><tr><th>交易閉環</th><th>{config.xShort}</th><th>{config.yShort}</th><th>分類／缺資料原因</th><th>操作</th></tr></thead><tbody>{all.map(point => <tr key={point.cycleId}><td><b>{point.symbol}・{direction(point)}</b><small>{date(point.openAt)} → {date(point.closeAt)}</small></td><td>{matrixPercent(matrixCoordinates(point, kind).x, 2)}</td><td>{matrixPercent(matrixCoordinates(point, kind).y, 2)}</td><td>{point.reason || label(point)}</td><td><button type="button" className="text-button" onClick={() => choose(point)}>查看 {point.symbol} 摘要</button></td></tr>)}</tbody></table></div></details>
  </article>;
}
