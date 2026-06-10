"use client";

import { useMemo, useState } from "react";

type Preset = { key: string; label: string; thickness: number; labor: number };

const PRESETS: Preset[] = [
  { key: "driveway", label: "Driveway", thickness: 4, labor: 6 },
  { key: "patio", label: "Patio", thickness: 4, labor: 7 },
  { key: "walkway", label: "Walkway", thickness: 4, labor: 6 },
  { key: "slab", label: "Garage / Shed slab", thickness: 4, labor: 5 },
  { key: "custom", label: "Custom", thickness: 4, labor: 6 },
];

function n(v: string, fallback = 0): number {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : fallback;
}
function usd(x: number): string {
  return `$${Math.round(x).toLocaleString("en-US")}`;
}

export function Calculator() {
  const [preset, setPreset] = useState("driveway");
  const [mode, setMode] = useState<"dims" | "area">("dims");
  const [length, setLength] = useState("40");
  const [width, setWidth] = useState("12");
  const [areaInput, setAreaInput] = useState("480");
  const [thickness, setThickness] = useState("4");
  const [pricePerYd, setPricePerYd] = useState("160");
  const [laborPerSqft, setLaborPerSqft] = useState("6");
  const [waste, setWaste] = useState("10");
  const [margin, setMargin] = useState("40");
  const [copied, setCopied] = useState(false);

  function applyPreset(p: Preset) {
    setPreset(p.key);
    if (p.key !== "custom") {
      setThickness(String(p.thickness));
      setLaborPerSqft(String(p.labor));
    }
  }

  const r = useMemo(() => {
    const area = mode === "area" ? n(areaInput) : n(length) * n(width);
    const thick = n(thickness, 4);
    const rawYards = (area * (thick / 12)) / 27;
    const yards = rawYards * (1 + n(waste) / 100);
    const material = yards * n(pricePerYd, 160);
    const labor = area * n(laborPerSqft, 6);
    const cost = material + labor;
    const suggested = cost * (1 + n(margin) / 100);
    const perSqft = area > 0 ? suggested / area : 0;
    return { area, yards, material, labor, cost, suggested, perSqft };
  }, [mode, areaInput, length, width, thickness, pricePerYd, laborPerSqft, waste, margin]);

  async function copySummary() {
    const text =
      `Estimate\n` +
      `Area: ${Math.round(r.area)} sq ft\n` +
      `Concrete: ${r.yards.toFixed(2)} cu yd (incl. ${n(waste)}% waste)\n` +
      `Material: ${usd(r.material)}\n` +
      `Labor: ${usd(r.labor)}\n` +
      `Cost: ${usd(r.cost)}\n` +
      `Suggested price: ${usd(r.suggested)} (${usd(r.perSqft)}/sq ft)`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="calc">
      <div className="calc-inputs crm-card">
        <div className="calc-presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`calc-chip${preset === p.key ? " calc-chip-on" : ""}`}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="calc-toggle">
          <button type="button" className={mode === "dims" ? "on" : ""} onClick={() => setMode("dims")}>
            By dimensions
          </button>
          <button type="button" className={mode === "area" ? "on" : ""} onClick={() => setMode("area")}>
            By area
          </button>
        </div>

        {mode === "dims" ? (
          <div className="calc-row">
            <label className="crm-field">
              <span>Length (ft)</span>
              <input className="crm-input" inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} />
            </label>
            <label className="crm-field">
              <span>Width (ft)</span>
              <input className="crm-input" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
            </label>
          </div>
        ) : (
          <label className="crm-field">
            <span>Area (sq ft)</span>
            <input className="crm-input" inputMode="decimal" value={areaInput} onChange={(e) => setAreaInput(e.target.value)} />
          </label>
        )}

        <div className="calc-row">
          <label className="crm-field">
            <span>Thickness (in)</span>
            <input className="crm-input" inputMode="decimal" value={thickness} onChange={(e) => setThickness(e.target.value)} />
          </label>
          <label className="crm-field">
            <span>Waste %</span>
            <input className="crm-input" inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} />
          </label>
        </div>

        <div className="calc-row">
          <label className="crm-field">
            <span>Concrete $/cu yd</span>
            <input className="crm-input" inputMode="decimal" value={pricePerYd} onChange={(e) => setPricePerYd(e.target.value)} />
          </label>
          <label className="crm-field">
            <span>Labor $/sq ft</span>
            <input className="crm-input" inputMode="decimal" value={laborPerSqft} onChange={(e) => setLaborPerSqft(e.target.value)} />
          </label>
          <label className="crm-field">
            <span>Margin %</span>
            <input className="crm-input" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="calc-result">
        <div className="calc-price">
          <span className="calc-price-label">Suggested price</span>
          <span className="calc-price-value">{usd(r.suggested)}</span>
          <span className="calc-price-sub">{usd(r.perSqft)}/sq ft · {Math.round(r.area)} sq ft</span>
        </div>
        <ul className="calc-lines">
          <li>
            <span>Concrete needed</span>
            <strong>{r.yards.toFixed(2)} cu yd</strong>
          </li>
          <li>
            <span>Material</span>
            <strong>{usd(r.material)}</strong>
          </li>
          <li>
            <span>Labor</span>
            <strong>{usd(r.labor)}</strong>
          </li>
          <li className="calc-lines-total">
            <span>Your cost</span>
            <strong>{usd(r.cost)}</strong>
          </li>
        </ul>
        <button type="button" className="crm-btn crm-btn-primary calc-copy" onClick={copySummary}>
          {copied ? "Copied" : "Copy estimate"}
        </button>
        <p className="crm-muted crm-sm">Estimate only. Adjust the rates to match your supplier and crew.</p>
      </div>
    </div>
  );
}
