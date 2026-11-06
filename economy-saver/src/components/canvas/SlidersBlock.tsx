"use client";

import type { SlidersData } from "@/lib/canvas/resolve";

/** One slider per client: how many days later than their own pace they pay. The page redraws the blocks that use the canvas scenario; nothing is saved. */
export function SlidersBlock({ data, values, onChange }: { data: SlidersData; values: Record<string, number>; onChange: (clientId: string, days: number) => void }) {
  return <div className="canvas-sliders">
    {data.controls.map(control => {
      const days = values[control.clientId] ?? control.days;
      const inputId = `canvas-slider-${control.clientId}`;
      return <div key={control.clientId} className="canvas-slider">
        <label htmlFor={inputId}><span>{control.name} pays</span><b>{days === 0 ? "on their usual day" : `${days} ${days === 1 ? "day" : "days"} later`}</b></label>
        <input id={inputId} type="range" min={0} max={control.maxDays} step={1} value={days} onChange={event => onChange(control.clientId, Number(event.target.value))} />
        {control.pace && <small>{control.pace}</small>}
      </div>;
    })}
  </div>;
}
