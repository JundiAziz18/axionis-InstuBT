import React, { useEffect, useRef, useState } from 'react';
import { Camera, Video, Globe, Radio, AlertCircle, FlipVertical, FlipHorizontal, RotateCw } from 'lucide-react';
import { LiveTelemetry } from '../types';
import { normalizeCameraFrame } from '../firebase';

type CameraSourceMode = 'esp32_mqtt' | 'mjpeg_url' | 'local_webcam';

const STREAM_URL_STORAGE_KEY = 'axionis_esp32_stream_url_v1';
const CAM_ORIENTATION_STORAGE_KEY = 'axionis_esp32_cam_orientation_v1';

interface CamOrientation {
  flipV: boolean;
  mirrorH: boolean;
  rotateDeg: 0 | 90 | 180 | 270;
}

export const LiveCameraViewport: React.FC<{
  telemetry: LiveTelemetry;
  deviceOnline: boolean;
  deviceIp?: string;
  hasReceivedLivePacket?: boolean;
  faceThreshold: number;
  holdDuration: number;
  privacyBlur: boolean;
}> = ({
  telemetry,
  deviceOnline,
  deviceIp = '192.168.1.42',
  hasReceivedLivePacket = false,
  faceThreshold,
  holdDuration,
  privacyBlur,
}) => {
  const [sourceMode, setSourceMode] = useState<CameraSourceMode>('esp32_mqtt');
  const defaultIpStream = `http://${deviceIp}:81/stream`;
  const [customStreamUrl, setCustomStreamUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(STREAM_URL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [streamInputDraft, setStreamInputDraft] = useState<string>(
    customStreamUrl || defaultIpStream
  );
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [mjpegLoadError, setMjpegLoadError] = useState<boolean>(false);

  const [orientation, setOrientation] = useState<CamOrientation>(() => {
    try {
      const saved = localStorage.getItem(CAM_ORIENTATION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          flipV: Boolean(parsed.flipV),
          mirrorH: Boolean(parsed.mirrorH),
          rotateDeg: [0, 90, 180, 270].includes(parsed.rotateDeg) ? parsed.rotateDeg : 0,
        };
      }
    } catch {}
    return { flipV: false, mirrorH: false, rotateDeg: 0 };
  });

  const updateOrientation = (updater: (prev: CamOrientation) => CamOrientation) => {
    setOrientation((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(CAM_ORIENTATION_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const rotateClass =
    orientation.rotateDeg === 90
      ? 'rotate-90'
      : orientation.rotateDeg === 180
      ? 'rotate-180'
      : orientation.rotateDeg === 270
      ? '-rotate-90'
      : 'rotate-0';
  const flipVClass = orientation.flipV ? 'scale-y-[-1]' : '';
  const mirrorHClass = orientation.mirrorH ? 'scale-x-[-1]' : '';
  const camTransformClasses = `${rotateClass} ${flipVClass} ${mirrorHClass}`.trim();

  // Sync draft URL when ESP32 reports its real local IP via net.h status packet
  useEffect(() => {
    if (!customStreamUrl && deviceIp) {
      setStreamInputDraft(`http://${deviceIp}:81/stream`);
    }
  }, [deviceIp, customStreamUrl]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const isAnomalous = telemetry.faceProb >= faceThreshold;
  const borderColor = !deviceOnline
    ? 'border-zinc-700'
    : isAnomalous
    ? 'border-rose-500/80'
    : 'border-teal-600/70';

  const normalizedFrame =
    deviceOnline && hasReceivedLivePacket
      ? normalizeCameraFrame(telemetry.snapshotB64 || telemetry.streamUrl || null)
      : null;

  // Manage Local Webcam Stream when mode === 'local_webcam'
  useEffect(() => {
    if (sourceMode !== 'local_webcam') {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      setWebcamError(null);
      return;
    }

    let active = true;
    setWebcamError(null);

    navigator.mediaDevices
      ?.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        if (active) {
          setWebcamError('Izin kamera browser ditolak atau kamera tidak ditemukan.');
        }
      });

    return () => {
      active = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [sourceMode]);

  const handleSaveStreamUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = streamInputDraft.trim();
    setCustomStreamUrl(cleaned);
    setMjpegLoadError(false);
    try {
      localStorage.setItem(STREAM_URL_STORAGE_KEY, cleaned);
    } catch {}
  };

  return (
    <div className="w-full max-w-full space-y-2">
      {/* Compact Camera Source Switcher & Orientation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800 max-w-full overflow-x-auto">
          <button
            type="button"
            onClick={() => setSourceMode('esp32_mqtt')}
            className={`px-2 py-1 rounded-md font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              sourceMode === 'esp32_mqtt'
                ? 'bg-teal-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Radio className="w-3 h-3 shrink-0" />
            <span>ESP32 MQTT</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('mjpeg_url')}
            className={`px-2 py-1 rounded-md font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              sourceMode === 'mjpeg_url'
                ? 'bg-teal-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Globe className="w-3 h-3 shrink-0" />
            <span>IP Stream</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('local_webcam')}
            className={`px-2 py-1 rounded-md font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              sourceMode === 'local_webcam'
                ? 'bg-teal-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Video className="w-3 h-3 shrink-0" />
            <span>Kamera Web</span>
          </button>
        </div>

        {/* Camera Orientation Toolbar (Flip V, Mirror H, Rotate) */}
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800">
          <button
            type="button"
            title="Balik Vertikal (Flip V - Atasi Kamera Terbalik)"
            onClick={() => updateOrientation((o) => ({ ...o, flipV: !o.flipV }))}
            className={`px-2 py-1 rounded-md font-mono text-[10px] flex items-center gap-1 transition-colors ${
              orientation.flipV
                ? 'bg-teal-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FlipVertical className="w-3 h-3 shrink-0" />
            <span>Flip V</span>
          </button>
          <button
            type="button"
            title="Cermin Horizontal (Mirror H - Sesuai Posisi LCD)"
            onClick={() => updateOrientation((o) => ({ ...o, mirrorH: !o.mirrorH }))}
            className={`px-2 py-1 rounded-md font-mono text-[10px] flex items-center gap-1 transition-colors ${
              orientation.mirrorH
                ? 'bg-teal-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FlipHorizontal className="w-3 h-3 shrink-0" />
            <span>Mirror H</span>
          </button>
          <button
            type="button"
            title="Putar Orientasi Kamera 90 Derajat"
            onClick={() =>
              updateOrientation((o) => ({
                ...o,
                rotateDeg: ((o.rotateDeg + 90) % 360) as 0 | 90 | 180 | 270,
              }))
            }
            className={`px-2 py-1 rounded-md font-mono text-[10px] flex items-center gap-1 transition-colors ${
              orientation.rotateDeg !== 0
                ? 'bg-teal-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <RotateCw className="w-3 h-3 shrink-0" />
            <span>{orientation.rotateDeg}°</span>
          </button>
        </div>
      </div>

      {/* Status Subtitle */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
        <span className="truncate">
          {sourceMode === 'esp32_mqtt'
            ? !deviceOnline || !hasReceivedLivePacket
              ? 'Perangkat Terputus / Offline'
              : normalizedFrame
              ? 'Live Stream MQTT Aktif'
              : 'Telemetri Aktif (Menunggu Frame)'
            : sourceMode === 'mjpeg_url'
            ? 'HTTP MJPEG'
            : 'Kamera Lokal'}
        </span>
        {(orientation.flipV || orientation.mirrorH || orientation.rotateDeg !== 0) && (
          <button
            type="button"
            onClick={() => updateOrientation(() => ({ flipV: false, mirrorH: false, rotateDeg: 0 }))}
            className="text-teal-400 hover:text-teal-300 underline"
          >
            Reset Orientasi
          </button>
        )}
      </div>

      {/* Optional MJPEG URL Input Bar when in IP Stream mode */}
      {sourceMode === 'mjpeg_url' && (
        <form onSubmit={handleSaveStreamUrl} className="flex items-center gap-1.5 text-xs">
          <input
            type="url"
            value={streamInputDraft}
            onChange={(e) => setStreamInputDraft(e.target.value)}
            placeholder="http://192.168.1.42:81/stream"
            className="flex-1 min-w-0 min-h-[34px] px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-[11px]"
          />
          <button
            type="submit"
            className="min-h-[34px] px-3 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-semibold text-[11px] shrink-0"
          >
            Hubungkan
          </button>
        </form>
      )}

      {/* Main Camera Viewport */}
      <div className="relative w-full max-w-full h-52 sm:h-72 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden flex items-center justify-center">
        {/* MODE 1: ESP32 MQTT Base64 Frame (Immediately hidden if device disconnects or frame times out) */}
        {sourceMode === 'esp32_mqtt' && normalizedFrame && (
          <img
            src={normalizedFrame}
            alt="ESP32-S3 OV5640 Frame"
            referrerPolicy="no-referrer"
            className={`w-full h-full object-contain transition-all duration-150 ${camTransformClasses} ${
              privacyBlur ? 'blur-md' : ''
            }`}
          />
        )}

        {/* MODE 2: ESP32 HTTP MJPEG Stream URL */}
        {sourceMode === 'mjpeg_url' && customStreamUrl && !mjpegLoadError && (
          <img
            src={customStreamUrl}
            alt="ESP32-S3 MJPEG Stream"
            referrerPolicy="no-referrer"
            onError={() => setMjpegLoadError(true)}
            className={`w-full h-full object-contain transition-all duration-200 ${camTransformClasses} ${
              privacyBlur ? 'blur-md' : ''
            }`}
          />
        )}

        {/* MODE 3: Local Device Webcam */}
        {sourceMode === 'local_webcam' && !webcamError && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover transition-all duration-200 ${
              orientation.mirrorH ? 'scale-x-[1]' : 'scale-x-[-1]'
            } ${rotateClass} ${flipVClass} ${
              privacyBlur ? 'blur-md' : ''
            }`}
          />
        )}

        {/* ROI HUD Overlay when Live Image / Video is Active */}
        {((sourceMode === 'esp32_mqtt' && normalizedFrame) ||
          (sourceMode === 'mjpeg_url' && customStreamUrl && !mjpegLoadError) ||
          (sourceMode === 'local_webcam' && !webcamError)) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
            <div
              className={`w-36 h-36 sm:w-48 sm:h-48 max-w-full max-h-full rounded-xl border-2 ${borderColor} bg-zinc-950/20 flex flex-col justify-between p-2 sm:p-3`}
            >
              <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px] font-mono tabular-nums bg-zinc-950/75 px-2 py-0.5 rounded">
                <span
                  className={`truncate ${
                    isAnomalous ? 'text-rose-300 font-semibold' : 'text-teal-300 font-semibold'
                  }`}
                >
                  {telemetry.faceDetected
                    ? `${isAnomalous ? 'ASIMETRI' : 'NORMAL'} ${(telemetry.faceProb * 100).toFixed(0)}%`
                    : 'NO FACE'}
                </span>
                <span className="text-zinc-300 shrink-0">
                  {telemetry.holdElapsedSec.toFixed(1)}/{holdDuration}s
                </span>
              </div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-200 bg-zinc-950/75 px-2 py-0.5 rounded self-center">
                ROI 240x240 · INT8
              </div>
            </div>
          </div>
        )}

        {/* Fallback State when No Stream Frame is Present or Device Disconnected */}
        {((sourceMode === 'esp32_mqtt' && !normalizedFrame) ||
          (sourceMode === 'mjpeg_url' && (!customStreamUrl || mjpegLoadError)) ||
          (sourceMode === 'local_webcam' && webcamError)) && (
          <div
            className={`w-full h-full flex flex-col items-center justify-center p-3 sm:p-6 ${
              privacyBlur ? 'blur-md' : ''
            }`}
          >
            <div
              className={`w-48 h-40 sm:w-60 sm:h-48 max-w-full max-h-full rounded-xl border ${borderColor} bg-zinc-900/60 flex flex-col justify-between p-3 sm:p-3.5 transition-colors`}
            >
              <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px] font-mono tabular-nums">
                <span
                  className={`truncate ${
                    !deviceOnline || !hasReceivedLivePacket
                      ? 'text-zinc-400 font-semibold'
                      : isAnomalous
                      ? 'text-rose-300 font-semibold'
                      : 'text-teal-300 font-semibold'
                  }`}
                >
                  {!deviceOnline || !hasReceivedLivePacket
                    ? 'OFFLINE'
                    : telemetry.faceDetected
                    ? `${isAnomalous ? 'ASIMETRI' : 'NORMAL'} ${(telemetry.faceProb * 100).toFixed(0)}%`
                    : 'NO FACE'}
                </span>
                <span className="text-zinc-400 shrink-0">
                  {telemetry.holdElapsedSec.toFixed(1)}/{holdDuration}s
                </span>
              </div>

              <div className="text-center space-y-1.5">
                {webcamError || mjpegLoadError ? (
                  <AlertCircle className="w-5 h-5 text-amber-400 mx-auto" />
                ) : (
                  <Camera className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-500 mx-auto" />
                )}
                <div className="text-[10px] sm:text-[11px] text-zinc-300 font-mono leading-tight px-1">
                  {sourceMode === 'local_webcam' && webcamError
                    ? webcamError
                    : sourceMode === 'mjpeg_url'
                    ? mjpegLoadError
                      ? 'Gagal memuat URL Stream MJPEG'
                      : 'Masukkan URL Stream ESP32 di atas'
                    : !deviceOnline || !hasReceivedLivePacket
                    ? 'Perangkat Terputus · Menunggu Stream ESP32'
                    : 'ESP32 Aktif · Menunggu Frame Kamera'}
                </div>
                {sourceMode === 'esp32_mqtt' && !normalizedFrame && (
                  <button
                    type="button"
                    onClick={() => setSourceMode('local_webcam')}
                    className="mt-1 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-teal-300 text-[10px] font-sans font-medium transition-colors"
                  >
                    Gunakan Kamera Web
                  </button>
                )}
              </div>

              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 text-center truncate">
                ROI 240x240 · INT8
              </div>
            </div>
          </div>
        )}

        {privacyBlur && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 p-2">
            <span className="bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-lg text-xs text-zinc-300 text-center">
              Mode Privasi Aktif
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const AudioWaveformBar: React.FC<{
  telemetry: LiveTelemetry;
  deviceOnline?: boolean;
  hasReceivedLivePacket?: boolean;
  hasLiveAudioPacket?: boolean;
  rmsThreshold: number;
  dysThreshold: number;
}> = ({
  telemetry,
  deviceOnline = false,
  hasReceivedLivePacket = false,
  hasLiveAudioPacket = false,
  rmsThreshold,
  dysThreshold,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<number>(0);
  const historyRmsRef = useRef<number[]>(Array.from({ length: 48 }, () => 0));

  useEffect(() => {
    const isConnected = deviceOnline && hasReceivedLivePacket;
    const currentRms = isConnected ? Math.max(0, Number(telemetry.rms) || 0) : 0;
    historyRmsRef.current = [...historyRmsRef.current.slice(1), currentRms];
  }, [telemetry.rms, telemetry.dysProb, deviceOnline, hasReceivedLivePacket]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const isConnected = deviceOnline && hasReceivedLivePacket;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = '#09090B';
      ctx.fillRect(0, 0, w, h);

      // Draw subtle threshold reference line
      const threshY = Math.max(14, h - 12 - Math.min(h - 24, rmsThreshold * 3800));
      ctx.strokeStyle = 'rgba(113, 113, 122, 0.25)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(8, threshY);
      ctx.lineTo(w - 8, threshY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!isConnected) {
        // Offline / Disconnected flatline
        ctx.strokeStyle = 'rgba(82, 82, 91, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(8, h / 2);
        ctx.lineTo(w - 8, h / 2);
        ctx.stroke();
        return;
      }

      phaseRef.current += 0.16;
      const rms = Math.max(0, Number(telemetry.rms) || 0);
      const dys = Math.max(0, Number(telemetry.dysProb) || 0);
      const isHighDys = dys >= dysThreshold;
      const isGateOpen = rms >= rmsThreshold || telemetry.state === 'RECORDING_AUDIO_2S';

      const bins =
        telemetry.mfccBins && telemetry.mfccBins.length > 0
          ? telemetry.mfccBins
          : Array.from({ length: 16 }, () => 8);
      const barW = (w - 16) / Math.max(1, bins.length);
      const maxBarH = h - 22;

      // 1. Draw live animated MFCC / I2S frequency bars
      bins.forEach((baseEnergy, idx) => {
        const liveJitter =
          rms > 0.0001
            ? Math.sin(phaseRef.current * 1.4 + idx * 0.7) * Math.min(18, rms * 2600 + 3)
            : Math.sin(phaseRef.current * 0.8 + idx) * 1.5;
        const effectiveEnergy = Math.max(4, Math.min(100, baseEnergy + liveJitter));
        const barH = Math.max(3, (effectiveEnergy / 100) * maxBarH);
        const bx = 8 + idx * barW;
        const by = h - 8 - barH;

        ctx.fillStyle = isHighDys
          ? 'rgba(225, 29, 72, 0.72)'
          : isGateOpen
          ? 'rgba(20, 184, 166, 0.75)'
          : 'rgba(63, 63, 70, 0.55)';
        ctx.fillRect(bx, by, Math.max(3, barW - 4), barH);
      });

      // 2. Draw live oscilloscope time-domain wave on top
      ctx.strokeStyle = isHighDys
        ? '#FDA4AF'
        : isGateOpen
        ? '#5EEAD4'
        : 'rgba(161, 161, 170, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const wavePoints = 40;
      const amp = Math.min(h * 0.36, Math.max(2.5, rms * 4200));
      for (let i = 0; i < wavePoints; i++) {
        const x = 8 + (i / (wavePoints - 1)) * (w - 16);
        const y =
          h * 0.48 +
          Math.sin(phaseRef.current * 2.1 + i * 0.45) *
            amp *
            Math.cos(i * 0.15 - phaseRef.current * 0.5);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [telemetry, deviceOnline, hasReceivedLivePacket, rmsThreshold, dysThreshold]);

  const isConnected = deviceOnline && hasReceivedLivePacket;
  const dbFs =
    isConnected && telemetry.rms > 0.00001
      ? Math.max(-60, Math.min(0, Math.round(20 * Math.log10(telemetry.rms * 15))))
      : -60;

  return (
    <div className="relative w-full max-w-full rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <canvas ref={canvasRef} width={320} height={96} className="w-full h-20 sm:h-24 block" />
      <div className="pointer-events-none absolute top-1.5 left-2 right-2 flex items-center justify-between text-[10px] font-mono">
        <span
          className={`px-1.5 py-0.5 rounded bg-zinc-950/80 border ${
            !isConnected
              ? 'text-zinc-500 border-zinc-800'
              : telemetry.state === 'RECORDING_AUDIO_2S'
              ? 'text-rose-300 border-rose-800/70 animate-pulse'
              : hasLiveAudioPacket || telemetry.rms >= rmsThreshold
              ? 'text-teal-300 border-teal-800/60'
              : 'text-amber-300 border-amber-800/60'
          }`}
        >
          {!isConnected
            ? 'INMP441 OFFLINE'
            : telemetry.state === 'RECORDING_AUDIO_2S'
            ? 'REC INMP441 (2s)'
            : hasLiveAudioPacket
            ? 'INMP441 LIVE'
            : 'STANDBY (GATE)'}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-zinc-950/80 text-zinc-400">
          {isConnected ? `${dbFs} dBFS` : '-- dBFS'}
        </span>
      </div>
    </div>
  );
};

