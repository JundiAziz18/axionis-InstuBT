import React, { useState } from 'react';
import { StrokeEvent } from '../types';

interface DetectionHistoryChartProps {
  events: StrokeEvent[];
  faceThreshold: number;
  dysThreshold: number;
  isLight?: boolean;
}

function formatShortTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatFullTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return (
    d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
    ' WIB'
  );
}

export const DetectionHistoryChart: React.FC<DetectionHistoryChartProps> = ({
  events,
  faceThreshold,
  dysThreshold,
  isLight = false,
}) => {
  // Sort oldest to newest for left-to-right timeline visualization
  const chronological = [...events].slice(0, 12).reverse();

  const [activeIndex, setActiveIndex] = useState<number | null>(
    chronological.length > 0 ? chronological.length - 1 : null
  );

  if (chronological.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-zinc-500 font-mono text-center px-3">
        Belum ada data riwayat deteksi untuk ditampilkan pada grafik.
      </div>
    );
  }

  const width = 680;
  const height = 210;
  const padLeft = 44;
  const padRight = 28;
  const padTop = 18;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getX = (idx: number) => {
    if (chronological.length === 1) return padLeft + plotW / 2;
    return padLeft + (idx / (chronological.length - 1)) * plotW;
  };

  const getYPercent = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    return padTop + plotH - (clamped / 100) * plotH;
  };

  // Scale RMS (0.0005 - 0.0250) to 0-100% for visual comparison
  const getRmsNormalized = (rms: number) => Math.max(0, Math.min(100, rms * 4000));

  const facePoints = chronological
    .map((e, i) => `${getX(i)},${getYPercent(e.faceProb * 100)}`)
    .join(' ');

  const dysPoints = chronological
    .map((e, i) => `${getX(i)},${getYPercent(e.dysProb * 100)}`)
    .join(' ');

  const rmsPoints = chronological
    .map((e, i) => `${getX(i)},${getYPercent(getRmsNormalized(e.rms))}`)
    .join(' ');

  const selectedEvt =
    activeIndex !== null && chronological[activeIndex]
      ? chronological[activeIndex]
      : chronological[chronological.length - 1];

  const gridColor = isLight ? '#E7E5E4' : '#27272A';
  const labelColor = isLight ? '#78716C' : '#71717A';

  return (
    <div className="w-full max-w-full space-y-3 overflow-hidden">
      {/* Legend & Responsive Point Readout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-[11px] sm:text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block shrink-0" />
            <span className="text-zinc-400">Wajah (%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block shrink-0" />
            <span className="text-zinc-400">Suara (%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-400 inline-block shrink-0" />
            <span className="text-zinc-400">RMS</span>
          </div>
        </div>

        {selectedEvt && (
          <div className="w-full sm:w-auto flex flex-wrap items-center justify-between sm:justify-end gap-x-2.5 gap-y-1 font-mono text-[10px] sm:text-[11px] bg-zinc-950/60 border border-zinc-800/80 px-2.5 py-1.5 rounded-lg text-zinc-300">
            <span
              className={
                selectedEvt.level === 'CRITICAL'
                  ? 'text-rose-400 font-bold'
                  : selectedEvt.level === 'WARNING'
                  ? 'text-amber-400 font-bold'
                  : 'text-teal-400 font-bold'
              }
            >
              {selectedEvt.level}
            </span>
            <span className="text-zinc-400">{formatFullTime(selectedEvt.timestamp)}</span>
            <span className="text-rose-300">Wajah: {(selectedEvt.faceProb * 100).toFixed(1)}%</span>
            <span className="text-amber-300">Suara: {(selectedEvt.dysProb * 100).toFixed(1)}%</span>
            <span className="text-teal-300">RMS: {selectedEvt.rms.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Contained SVG Chart — Scales cleanly inside mobile portrait frame */}
      <div className="w-full max-w-full rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-1.5 sm:p-2 overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-40 sm:h-52 block select-none overflow-hidden"
        >
          {/* Horizontal Percentage Grid Lines */}
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = getYPercent(pct);
            return (
              <g key={pct}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={gridColor}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill={labelColor}
                  fontFamily="monospace"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {/* Face Threshold Reference Line */}
          <line
            x1={padLeft}
            y1={getYPercent(faceThreshold * 100)}
            x2={width - padRight}
            y2={getYPercent(faceThreshold * 100)}
            stroke="#F43F5E"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.45"
          />

          {/* Dysarthria Threshold Reference Line */}
          <line
            x1={padLeft}
            y1={getYPercent(dysThreshold * 100)}
            x2={width - padRight}
            y2={getYPercent(dysThreshold * 100)}
            stroke="#F59E0B"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.45"
          />

          {/* Trend Lines */}
          {chronological.length > 1 && (
            <>
              <polyline
                fill="none"
                stroke="#14B8A6"
                strokeWidth="2"
                points={rmsPoints}
                opacity="0.75"
              />
              <polyline
                fill="none"
                stroke="#FBBF24"
                strokeWidth="2.2"
                points={dysPoints}
                opacity="0.85"
              />
              <polyline
                fill="none"
                stroke="#FB7185"
                strokeWidth="2.5"
                points={facePoints}
              />
            </>
          )}

          {/* Interactive Data Nodes */}
          {chronological.map((evt, idx) => {
            const x = getX(idx);
            const yFace = getYPercent(evt.faceProb * 100);
            const yDys = getYPercent(evt.dysProb * 100);
            const yRms = getYPercent(getRmsNormalized(evt.rms));
            const isSelected = activeIndex === idx;

            return (
              <g
                key={evt.id}
                className="cursor-pointer"
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => setActiveIndex(idx)}
              >
                {isSelected && (
                  <line
                    x1={x}
                    y1={padTop}
                    x2={x}
                    y2={height - padBottom}
                    stroke="#52525B"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}

                <circle
                  cx={x}
                  cy={yRms}
                  r={isSelected ? 5 : 3.5}
                  fill="#14B8A6"
                  stroke="#09090B"
                  strokeWidth="1.5"
                />

                <circle
                  cx={x}
                  cy={yDys}
                  r={isSelected ? 5.5 : 4}
                  fill="#FBBF24"
                  stroke="#09090B"
                  strokeWidth="1.5"
                />

                <circle
                  cx={x}
                  cy={yFace}
                  r={isSelected ? 6 : 4.5}
                  fill="#FB7185"
                  stroke="#09090B"
                  strokeWidth="1.5"
                />

                <text
                  x={x}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="10"
                  fill={isSelected ? '#E4E4E7' : labelColor}
                  fontFamily="monospace"
                >
                  {formatShortTime(evt.timestamp)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
