import React, { useEffect, useRef } from 'react';
import { StrokeEvent } from '../types';

interface EventSnapshotGraphicProps {
  event: StrokeEvent;
  compact?: boolean;
}

export const EventSnapshotGraphic: React.FC<EventSnapshotGraphicProps> = ({ event, compact = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#09090B';
    ctx.fillRect(0, 0, w, h);

    const isCrit = event.level === 'CRITICAL';
    const isWarn = event.level === 'WARNING';
    const accent = isCrit ? '#E11D48' : isWarn ? '#D97706' : '#0D9488';

    // Left Half: 240x240 ROI Face Snapshot Representation
    const faceCx = w * 0.28;
    const faceCy = h * 0.5;
    const boxR = Math.min(w * 0.2, h * 0.36);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(faceCx - boxR, faceCy - boxR, boxR * 2, boxR * 2);

    ctx.strokeStyle = 'rgba(161, 161, 170, 0.4)';
    ctx.beginPath();
    ctx.ellipse(faceCx, faceCy, boxR * 0.65, boxR * 0.82, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#2DD4BF';
    ctx.beginPath();
    ctx.arc(faceCx - boxR * 0.25, faceCy - boxR * 0.18, 2.2, 0, Math.PI * 2);
    ctx.arc(faceCx + boxR * 0.25, faceCy - boxR * 0.14, 2.2, 0, Math.PI * 2);
    ctx.fill();

    const droop = event.faceProb * (boxR * 0.35);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(faceCx - boxR * 0.28, faceCy + boxR * 0.25);
    ctx.lineTo(faceCx + boxR * 0.28, faceCy + boxR * 0.25 + droop);
    ctx.stroke();

    // Right Half: 40-MFCC Audio Frame Spectrogram
    const specX = w * 0.54;
    const specW = w * 0.4;
    const bins = event.snapshotMeta?.mfccSummary || [50, 62, 74, 68, 55, 48, 60, 72, 64, 52, 45, 38];
    const barW = specW / bins.length;

    bins.forEach((val, idx) => {
      const barH = (val / 100) * (h * 0.58);
      ctx.fillStyle = event.dysProb >= 0.6 ? 'rgba(225, 29, 72, 0.7)' : 'rgba(13, 148, 136, 0.65)';
      ctx.fillRect(specX + idx * barW, h * 0.78 - barH, Math.max(2, barW - 2), barH);
    });

    ctx.font = '500 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(`ROI 240x240`, faceCx - boxR, h - 6);
    ctx.fillText(`40-MFCC (${event.snapshotMeta?.peakFreqHz || 420}Hz)`, specX, h - 6);
  }, [event]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <canvas
        ref={canvasRef}
        width={compact ? 240 : 320}
        height={compact ? 100 : 130}
        className="w-full h-24 object-cover block"
      />
    </div>
  );
};
