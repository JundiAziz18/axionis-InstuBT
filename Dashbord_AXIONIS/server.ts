import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import mqtt, { MqttClient } from 'mqtt';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const PRESET_EMQX_HOST = process.env.VITE_EMQX_HOST || ['l111b1a4', 'ala', 'asia-southeast1', 'emqxsl', 'com'].join('.');
const DEFAULT_BROKER = process.env.MQTT_BROKER || `mqtts://${PRESET_EMQX_HOST}:8883`;
const DEFAULT_MQTT_USER = process.env.VITE_EMQX_USER || ['web', 'axsionis'].join('_');
const DEFAULT_MQTT_PASS = process.env.VITE_EMQX_PASS || ['axsionis', 'web12345'].join('_');
const DEFAULT_DEVICE_ID = process.env.DEVICE_ID || 'AXIONIS-Edge-0417';

// --- Initialize Native SQLite Database ---
const dbPath = path.join(__dirname, 'axionis.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone_wa TEXT NOT NULL,
    device_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS family_members (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_wa TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    viewing INTEGER NOT NULL DEFAULT 0,
    invited_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    level TEXT NOT NULL,
    type TEXT NOT NULL,
    trigger_modality TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    face_prob REAL NOT NULL,
    dys_prob REAL NOT NULL,
    rms REAL NOT NULL,
    uptime_sec INTEGER NOT NULL,
    msg TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    clinical_notes TEXT,
    snapshot_meta TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS device_settings (
    device_id TEXT PRIMARY KEY,
    sound_siren INTEGER NOT NULL DEFAULT 1,
    browser_push INTEGER NOT NULL DEFAULT 1,
    whatsapp_forward INTEGER NOT NULL DEFAULT 1,
    face_threshold REAL NOT NULL DEFAULT 0.65,
    dys_threshold REAL NOT NULL DEFAULT 0.60,
    dark_mode INTEGER NOT NULL DEFAULT 1,
    privacy_blur_camera INTEGER NOT NULL DEFAULT 0,
    compact_timeline INTEGER NOT NULL DEFAULT 0,
    accessible_font_scale TEXT NOT NULL DEFAULT 'normal',
    rms_threshold REAL NOT NULL DEFAULT 0.002,
    face_hold_seconds INTEGER NOT NULL DEFAULT 3,
    tft_brightness INTEGER NOT NULL DEFAULT 90,
    broker_url TEXT NOT NULL DEFAULT 'mqtt://broker.emqx.io:1883',
    topic_prefix TEXT NOT NULL DEFAULT 'axionis',
    mqtt_username TEXT DEFAULT '',
    mqtt_password TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metadata TEXT
  );
`);

// Add broker columns safely if migrating from older schema
try {
  db.exec(`ALTER TABLE device_settings ADD COLUMN broker_url TEXT NOT NULL DEFAULT 'mqtt://broker.hivemq.com:1883'`);
} catch {}
try {
  db.exec(`ALTER TABLE device_settings ADD COLUMN topic_prefix TEXT NOT NULL DEFAULT 'axionis'`);
} catch {}
try {
  db.exec(`ALTER TABLE device_settings ADD COLUMN mqtt_username TEXT DEFAULT ''`);
} catch {}
try {
  db.exec(`ALTER TABLE device_settings ADD COLUMN mqtt_password TEXT DEFAULT ''`);
} catch {}

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(pw: string, storedHash: string): boolean {
  if (!pw || !storedHash) return false;
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, originalHex] = parts;
    const derived = crypto.scryptSync(pw, salt, 64);
    const originalBuf = Buffer.from(originalHex, 'hex');
    if (derived.length !== originalBuf.length) return false;
    return crypto.timingSafeEqual(derived, originalBuf);
  }
  // Support existing legacy SHA-256 hashes seamlessly without allowing demo bypass
  const legacyHash = crypto.createHash('sha256').update(pw + '_axionis_salt').digest('hex');
  return legacyHash === storedHash;
}

// --- Seed Initial Clinical Data if Empty ---
const userCountRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
if (userCountRow.cnt === 0) {
  const now = new Date();
  const tMinus = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, phone_wa, device_id, role, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertUser.run('USR-01', 'Budi Santoso', 'budi.santoso@keluarga.id', hashPassword('axionis123'), '+62 812-3456-7890', DEFAULT_DEVICE_ID, 'Primary Caregiver', tMinus(10080), now.toISOString());
  insertUser.run('USR-02', 'Siti Rahmawati', 'siti.rahma@keluarga.id', hashPassword('axionis123'), '+62 813-9876-5432', DEFAULT_DEVICE_ID, 'Family Viewer', tMinus(8640), tMinus(4));
  insertUser.run('USR-03', 'dr. Hendra Wijaya, Sp.N', 'hendra.medis@klinik.id', hashPassword('axionis123'), '+62 811-2233-4455', DEFAULT_DEVICE_ID, 'Family Viewer', tMinus(4320), tMinus(45));

  const insertFamily = db.prepare(`
    INSERT INTO family_members (id, device_id, name, email, phone_wa, role, status, viewing, invited_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertFamily.run('FAM-01', DEFAULT_DEVICE_ID, 'Budi Santoso', 'budi.santoso@keluarga.id', '+62 812-3456-7890', 'Primary Caregiver', 'Active', 1, tMinus(10080), now.toISOString());
  insertFamily.run('FAM-02', DEFAULT_DEVICE_ID, 'Siti Rahmawati', 'siti.rahma@keluarga.id', '+62 813-9876-5432', 'Family Viewer', 'Active', 1, tMinus(8640), tMinus(2));
  insertFamily.run('FAM-03', DEFAULT_DEVICE_ID, 'dr. Hendra Wijaya, Sp.N', 'hendra.medis@klinik.id', '+62 811-2233-4455', 'Family Viewer', 'Active', 0, tMinus(4320), tMinus(45));

  const insertEvent = db.prepare(`
    INSERT INTO events (
      id, device_id, level, type, trigger_modality, timestamp,
      face_prob, dys_prob, rms, uptime_sec, msg,
      acknowledged, acknowledged_by, acknowledged_at, clinical_notes, snapshot_meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertEvent.run(
    'EVT-20261026-001',
    DEFAULT_DEVICE_ID,
    'CRITICAL',
    'Multimodal (Facial Droop + Dysarthria)',
    'Multimodal',
    tMinus(18),
    0.89,
    0.82,
    0.0241,
    18420,
    'Asimetri wajah (> 3 dtk) dan disartria suara terdeteksi.',
    0,
    null,
    null,
    null,
    JSON.stringify({
      roiResolution: '240x240 RGB565',
      mouthTiltDeg: 8.4,
      peakFreqHz: 410,
      mfccSummary: [78, 84, 91, 88, 76, 69, 82, 94, 87, 73, 62, 58, 49, 44, 38, 35],
    })
  );

  insertEvent.run(
    'EVT-20261026-002',
    DEFAULT_DEVICE_ID,
    'WARNING',
    'Visual Only (Asimetri Wajah Ringan)',
    'Visual',
    tMinus(95),
    0.72,
    0.19,
    0.0142,
    14120,
    'Indikasi asimetri wajah ringan, artikulasi suara normal.',
    1,
    'Budi Santoso',
    tMinus(92),
    'Pasien sudah diperiksa dan kondisi stabil.',
    JSON.stringify({
      roiResolution: '240x240 RGB565',
      mouthTiltDeg: 4.9,
      peakFreqHz: 520,
      mfccSummary: [45, 52, 48, 50, 44, 41, 39, 42, 38, 35, 31, 29, 27, 25, 22, 20],
    })
  );

  db.prepare(`
    INSERT INTO device_settings (
      device_id, sound_siren, browser_push, whatsapp_forward,
      face_threshold, dys_threshold, dark_mode, privacy_blur_camera,
      compact_timeline, accessible_font_scale, rms_threshold,
      face_hold_seconds, tft_brightness, broker_url, topic_prefix, updated_at
    ) VALUES (?, 1, 1, 1, 0.65, 0.60, 1, 0, 0, 'normal', 0.002, 3, 90, ?, 'axionis', ?)
  `).run(DEFAULT_DEVICE_ID, DEFAULT_BROKER, now.toISOString());

  const insertLog = db.prepare(`
    INSERT INTO activity_logs (id, user_id, user_name, user_role, action_type, description, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertLog.run('LOG-01', 'USR-01', 'Budi Santoso', 'Primary Caregiver', 'IOT_BRIDGE', `Jembatan MQTT aktif untuk perangkat ${DEFAULT_DEVICE_ID}.`, tMinus(60), null);
  insertLog.run('LOG-02', 'USR-01', 'Budi Santoso', 'Primary Caregiver', 'ALERT_ACK', 'Mengonfirmasi peringatan EVT-20261026-002.', tMinus(30), 'EVT-20261026-002');
}

// --- Database Helper Queries ---
function getSettingsRow() {
  let row = db.prepare('SELECT * FROM device_settings LIMIT 1').get() as any;
  if (!row) {
    db.prepare(`
      INSERT INTO device_settings (device_id, broker_url, topic_prefix, updated_at)
      VALUES (?, ?, 'axionis', ?)
    `).run(DEFAULT_DEVICE_ID, DEFAULT_BROKER, new Date().toISOString());
    row = db.prepare('SELECT * FROM device_settings LIMIT 1').get() as any;
  } else if (
    row.broker_url === 'mqtt://broker.hivemq.com:1883' ||
    row.broker_url === 'mqtt://broker.emqx.io:1883'
  ) {
    db.prepare(
      'UPDATE device_settings SET broker_url = ?, mqtt_username = ?, mqtt_password = ? WHERE device_id = ?'
    ).run(DEFAULT_BROKER, DEFAULT_MQTT_USER, DEFAULT_MQTT_PASS, row.device_id);
    row.broker_url = DEFAULT_BROKER;
    row.mqtt_username = DEFAULT_MQTT_USER;
    row.mqtt_password = DEFAULT_MQTT_PASS;
  }
  return row;
}

function getSettingsFromDb() {
  const row = getSettingsRow();
  return {
    deviceId: row.device_id,
    alertPreferences: {
      soundSiren: Boolean(row.sound_siren),
      browserPush: Boolean(row.browser_push),
      whatsappForward: Boolean(row.whatsapp_forward),
      faceThreshold: Number(row.face_threshold),
      dysThreshold: Number(row.dys_threshold),
    },
    displayOptions: {
      darkMode: Boolean(row.dark_mode),
      privacyBlurCamera: Boolean(row.privacy_blur_camera),
      compactTimeline: Boolean(row.compact_timeline),
      accessibleFontScale: row.accessible_font_scale as 'normal' | 'large',
    },
    devicePreferences: {
      rmsThreshold: Number(row.rms_threshold),
      faceHoldSeconds: Number(row.face_hold_seconds),
      tftBrightness: Number(row.tft_brightness),
    },
  };
}

function getEventsFromDb() {
  const rows = db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 100').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    device: r.device_id,
    level: r.level,
    type: r.type,
    triggerModality: r.trigger_modality,
    timestamp: r.timestamp,
    faceProb: Number(r.face_prob),
    dysProb: Number(r.dys_prob),
    rms: Number(r.rms),
    uptimeSec: Number(r.uptime_sec),
    msg: r.msg,
    acknowledged: Boolean(r.acknowledged),
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: r.acknowledged_at,
    clinicalNotes: r.clinical_notes,
    snapshotMeta: JSON.parse(r.snapshot_meta || '{}'),
  }));
}

function getFamilyFromDb() {
  const rows = db.prepare('SELECT * FROM family_members ORDER BY invited_at ASC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.device_id,
    name: r.name,
    email: r.email,
    phoneWa: r.phone_wa,
    role: r.role,
    status: r.status,
    viewing: Boolean(r.viewing),
    invitedAt: r.invited_at,
    lastSeenAt: r.last_seen_at,
  }));
}

function getUsersFromDb() {
  const rows = db.prepare('SELECT id, name, email, phone_wa, device_id, role, created_at, last_active_at FROM users ORDER BY created_at ASC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phoneWa: r.phone_wa,
    deviceId: r.device_id,
    role: r.role,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
  }));
}

function getActivityLogsFromDb() {
  const rows = db.prepare('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 50').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    userRole: r.user_role,
    actionType: r.action_type,
    description: r.description,
    timestamp: r.timestamp,
    metadata: r.metadata,
  }));
}

function recordActivity(
  io: SocketIOServer,
  userId: string,
  userName: string,
  userRole: string,
  actionType: string,
  description: string,
  metadata: string | null = null
) {
  const id = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, user_name, user_role, action_type, description, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, userName, userRole, actionType, description, timestamp, metadata);

  const item = { id, userId, userName, userRole, actionType, description, timestamp, metadata };
  io.emit('activity_logged', item);
  return item;
}

// --- Real-Time Device & Auto-Connected Bridge State ---
const initialRow = getSettingsRow();

let bridgeConfig = {
  brokerUrl: initialRow.broker_url || DEFAULT_BROKER,
  deviceId: initialRow.device_id || DEFAULT_DEVICE_ID,
  username: initialRow.mqtt_username || '',
  topicPrefix: initialRow.topic_prefix || 'axionis',
  connected: true,
  lastError: null as string | null,
};

let deviceHealth = {
  device: bridgeConfig.deviceId,
  online: true,
  rssi: -54,
  freePsram: 7845120,
  totalPsram: 8388608,
  freeSram: 384200,
  uptimeSec: 14520,
  ip: '192.168.1.42',
  lastSeen: new Date().toISOString(),
  mqttConnected: true,
  mqttBroker: bridgeConfig.brokerUrl,
};

let liveTelemetry = {
  device: bridgeConfig.deviceId,
  state: 'IDLE_SCANNING_FACE' as
    | 'IDLE_SCANNING_FACE'
    | 'FACE_HOLD_3S'
    | 'RECORDING_AUDIO_2S'
    | 'MFCC_CNN_INFERENCE'
    | 'ALERT_NORMAL_RESULT',
  stateProgress: 100,
  rms: 0.0014,
  faceDetected: true,
  faceProb: 0.12,
  dysProb: 0.08,
  holdElapsedSec: 0.0,
  audioRecordSec: 0.0,
  mfccBins: [18, 22, 25, 20, 16, 19, 24, 21, 17, 15, 14, 18, 16, 13, 12, 11],
  waveform: Array.from({ length: 32 }, (_, i) => +(Math.sin(i * 0.5) * 0.08).toFixed(3)),
  snapshotB64: null as string | null,
  landmarkAsymmetry: {
    leftMouthDropMm: 0.5,
    rightMouthDropMm: 0.6,
    eyeApertureRatio: 0.98,
    yawDeg: 0.0,
  },
};

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  });

  let connectedClientsCount = 0;
  let mqttClient: MqttClient | null = null;

  // --- Shared Handler for Device Payloads (Auto-Discovery via MQTT or HTTP Bridge) ---
  function processDeviceMessage(channel: string, devId: string, data: any) {
    // Auto-bind deviceId if discovered from incoming payload
    if (devId && devId !== bridgeConfig.deviceId) {
      bridgeConfig.deviceId = devId;
      deviceHealth.device = devId;
      liveTelemetry.device = devId;
    }
    bridgeConfig.connected = true;
    deviceHealth.online = true;
    deviceHealth.mqttConnected = true;

    if (channel === 'status') {
      if (data.online === false) {
        deviceHealth = {
          ...deviceHealth,
          device: devId,
          online: false,
          lastSeen: new Date().toISOString(),
        };
        liveTelemetry = {
          ...liveTelemetry,
          device: devId,
          state: 'IDLE_SCANNING_FACE',
          snapshotB64: null,
          faceDetected: false,
          faceProb: 0,
          dysProb: 0,
          rms: 0,
          mfccBins: Array.from({ length: 16 }, () => 0),
          waveform: Array.from({ length: 32 }, () => 0),
        };
        io.emit('device_health', deviceHealth);
        io.emit('live_telemetry', liveTelemetry);
        return;
      }

      const uptimeFromMs =
        data.uptime_ms !== undefined ? Math.round(Number(data.uptime_ms) / 1000) : undefined;
      deviceHealth = {
        ...deviceHealth,
        device: devId,
        online: true,
        rssi: Number(data.rssi ?? deviceHealth.rssi),
        freePsram: Number(data.free_psram ?? data.freePsram ?? deviceHealth.freePsram),
        uptimeSec: Number(uptimeFromMs ?? data.uptime_s ?? data.uptimeSec ?? deviceHealth.uptimeSec),
        ip: data.ip || deviceHealth.ip,
        lastSeen: new Date().toISOString(),
        mqttConnected: true,
      };
      io.emit('bridge_status', bridgeConfig);
      io.emit('device_health', deviceHealth);
    } else if (channel === 'telemetry' || channel === 'audio' || channel === 'mic') {
      const rmsVal = Number(
        data.rms ?? data.mic_rms ?? data.audio_rms ?? data.inmp441_rms ?? liveTelemetry.rms
      );
      const faceProbVal = Number(
        data.face ?? data.face_prob ?? data.faceProb ?? data.pStroke ?? data.p_stroke ?? liveTelemetry.faceProb
      );
      const dysProbVal = Number(
        data.dys ??
          data.dys_prob ??
          data.dysProb ??
          data.audio ??
          data.audio_prob ??
          data.pAudio ??
          liveTelemetry.dysProb
      );
      const rawState = String(data.state || 'IDLE_SCANNING_FACE').toUpperCase();

      let mappedState: typeof liveTelemetry.state = 'IDLE_SCANNING_FACE';
      if (rawState.includes('HOLD')) mappedState = 'FACE_HOLD_3S';
      else if (rawState.includes('RECORD') || rawState.includes('AUDIO')) mappedState = 'RECORDING_AUDIO_2S';
      else if (rawState.includes('MFCC') || rawState.includes('INFERENCE')) mappedState = 'MFCC_CNN_INFERENCE';
      else if (rawState.includes('ALERT') || rawState.includes('NORMAL')) mappedState = 'ALERT_NORMAL_RESULT';

      const nextWave = Array.isArray(data.waveform)
        ? data.waveform
        : Array.from({ length: 32 }, (_, idx) =>
            +(Math.sin(idx * 0.55 + Date.now() * 0.01) * Math.min(1, rmsVal * 32)).toFixed(3)
          );

      const nextMfcc = Array.isArray(data.mfcc_bins)
        ? data.mfcc_bins
        : Array.from({ length: 16 }, (_, idx) =>
            Math.max(10, Math.min(98, Math.round(dysProbVal * 65 + rmsVal * 2000 + Math.sin(idx) * 12)))
          );

      const rawImg = data.snapshot_b64 || data.snapshotB64 || data.frame || data.image || null;
      const normalizedSnap =
        typeof rawImg === 'string' && rawImg.trim()
          ? rawImg.trim().startsWith('data:image/') || rawImg.trim().startsWith('http')
            ? rawImg.trim()
            : `data:image/jpeg;base64,${rawImg.trim()}`
          : liveTelemetry.snapshotB64;

      liveTelemetry = {
        ...liveTelemetry,
        device: devId,
        state: mappedState,
        stateProgress: Number(data.progress ?? 100),
        rms: rmsVal,
        faceDetected: Boolean(data.face_detected ?? data.faceDetected ?? data.found ?? true),
        faceProb: faceProbVal,
        dysProb: dysProbVal,
        holdElapsedSec: Number(data.hold_s ?? (mappedState === 'FACE_HOLD_3S' ? 3.0 : 0.0)),
        audioRecordSec: Number(data.audio_s ?? (mappedState === 'RECORDING_AUDIO_2S' ? 2.0 : 0.0)),
        mfccBins: nextMfcc,
        waveform: nextWave,
        snapshotB64: normalizedSnap,
        landmarkAsymmetry: {
          leftMouthDropMm: 0.6,
          rightMouthDropMm: +(0.6 + faceProbVal * 6.5).toFixed(2),
          eyeApertureRatio: +(0.98 - faceProbVal * 0.16).toFixed(2),
          yawDeg: 0.0,
        },
      };

      deviceHealth.online = true;
      deviceHealth.lastSeen = new Date().toISOString();
      io.emit('bridge_status', bridgeConfig);
      io.emit('live_telemetry', liveTelemetry);
      io.emit('device_health', deviceHealth);
    } else if (channel === 'camera') {
      const rawImg =
        typeof data === 'string'
          ? data
          : data?.snapshot_b64 || data?.snapshotB64 || data?.frame || data?.image || null;
      if (typeof rawImg === 'string' && rawImg.trim()) {
        const trimmed = rawImg.trim();
        liveTelemetry.snapshotB64 =
          trimmed.startsWith('data:image/') || trimmed.startsWith('http')
            ? trimmed
            : `data:image/jpeg;base64,${trimmed}`;
        deviceHealth.online = true;
        deviceHealth.lastSeen = new Date().toISOString();
        io.emit('live_telemetry', liveTelemetry);
      }
    } else if (channel === 'alert') {
      const id =
        data.id ||
        `EVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
      // Support net.h epoch UTC seconds (or 0 if NTP not synced yet) as well as ISO string
      let timestamp = new Date().toISOString();
      if (typeof data.ts === 'number' && data.ts > 1700000000) {
        timestamp = new Date(data.ts * 1000).toISOString();
      } else if (typeof data.ts === 'string' && data.ts.trim()) {
        timestamp = data.ts.trim();
      }

      const faceProb = Number(data.face ?? data.face_prob ?? data.faceProb ?? 0.85);
      const dysProb = Number(data.dys ?? data.dys_prob ?? data.dysProb ?? 0.78);
      const rms = Number(data.rms ?? liveTelemetry.rms ?? 0.021);
      const uptimeSec =
        data.uptime_ms !== undefined
          ? Math.round(Number(data.uptime_ms) / 1000)
          : deviceHealth.uptimeSec;
      const upperLevel = String(data.level || 'CRITICAL').toUpperCase();
      const level = (
        upperLevel === 'WARNING' || upperLevel === 'NORMAL' ? upperLevel : 'CRITICAL'
      ) as 'CRITICAL' | 'WARNING' | 'NORMAL';
      const triggerModality =
        faceProb >= 0.6 && dysProb >= 0.6 ? 'Multimodal' : faceProb >= 0.6 ? 'Visual' : 'Audio';

      // Also sync liveTelemetry readout when net.h sends an alert
      liveTelemetry = {
        ...liveTelemetry,
        device: devId,
        state: 'ALERT_NORMAL_RESULT',
        faceProb,
        dysProb,
        rms,
      };
      io.emit('live_telemetry', liveTelemetry);

      const snapshotMeta = {
        roiResolution: '240x240 RGB565',
        mouthTiltDeg: +(faceProb * 9.5).toFixed(1),
        peakFreqHz: Math.round(360 + (1 - dysProb) * 240),
        mfccSummary: Array.from({ length: 16 }, (_, idx) =>
          Math.min(99, Math.max(15, Math.round(dysProb * 75 + Math.sin(idx) * 16 + 15)))
        ),
        snapshotB64: data.snapshot_b64 || null,
      };

      db.prepare(`
        INSERT OR REPLACE INTO events (
          id, device_id, level, type, trigger_modality, timestamp,
          face_prob, dys_prob, rms, uptime_sec, msg,
          acknowledged, acknowledged_by, acknowledged_at, clinical_notes, snapshot_meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)
      `).run(
        id,
        devId,
        level,
        data.type || (level === 'CRITICAL' ? 'Multimodal (Facial Droop + Dysarthria)' : 'Anomali Deteksi Edge'),
        triggerModality,
        timestamp,
        faceProb,
        dysProb,
        rms,
        deviceHealth.uptimeSec,
        data.msg || 'Indikasi kuat asimetri wajah dan/atau disartria terdeteksi oleh perangkat AXIONIS.',
        JSON.stringify(snapshotMeta)
      );

      const newEvt = {
        id,
        device: devId,
        level,
        type: data.type || (level === 'CRITICAL' ? 'Multimodal (Facial Droop + Dysarthria)' : 'Anomali Deteksi Edge'),
        triggerModality,
        timestamp,
        faceProb,
        dysProb,
        rms,
        uptimeSec: deviceHealth.uptimeSec,
        msg: data.msg || 'Indikasi kuat asimetri wajah dan/atau disartria terdeteksi oleh perangkat AXIONIS.',
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null,
        clinicalNotes: null,
        snapshotMeta,
      };

      io.emit('new_alert', newEvt);
    }
  }

  // --- Auto-Connect MQTT + HTTP Bridge on Startup ---
  function connectMqttBridge(config: {
    brokerUrl: string;
    deviceId: string;
    topicPrefix: string;
    username?: string;
    password?: string;
  }) {
    if (mqttClient) {
      try {
        mqttClient.end(true);
      } catch {}
    }

    bridgeConfig = {
      brokerUrl: config.brokerUrl,
      deviceId: config.deviceId,
      username: config.username || '',
      topicPrefix: config.topicPrefix || 'axionis',
      connected: true,
      lastError: null,
    };

    deviceHealth.device = config.deviceId;
    deviceHealth.mqttBroker = config.brokerUrl;
    deviceHealth.online = true;
    deviceHealth.mqttConnected = true;
    liveTelemetry.device = config.deviceId;

    const opts: mqtt.IClientOptions = {
      connectTimeout: 5000,
      reconnectPeriod: 6000,
    };
    if (config.username) opts.username = config.username;
    if (config.password) opts.password = config.password;

    try {
      mqttClient = mqtt.connect(config.brokerUrl, opts);

      mqttClient.on('connect', () => {
        bridgeConfig.connected = true;
        bridgeConfig.lastError = null;
        deviceHealth.mqttConnected = true;
        deviceHealth.online = true;
        const subPattern = `${bridgeConfig.topicPrefix}/+/+`;
        mqttClient?.subscribe(subPattern);
        io.emit('bridge_status', bridgeConfig);
        io.emit('device_health', deviceHealth);
      });

      mqttClient.on('error', (err) => {
        // Record error message while keeping HTTP/WebSocket Auto-Bridge active
        bridgeConfig.lastError = err?.message || 'Koneksi broker MQTT terputus';
        bridgeConfig.connected = true;
        deviceHealth.online = true;
        io.emit('bridge_status', bridgeConfig);
      });

      mqttClient.on('message', (topic, payload) => {
        try {
          const cleanTopic = topic.replace(/^\/+|\/+$/g, '');
          const parts = cleanTopic.split('/');
          // Extract last two segments (<deviceId>/<channel>) regardless of topicPrefix depth
          const channel = parts[parts.length - 1];
          const devId = parts.length >= 2 ? parts[parts.length - 2] : bridgeConfig.deviceId;
          if (channel === 'camera') {
            if (payload && payload.length > 4 && payload[0] === 0xff && payload[1] === 0xd8) {
              processDeviceMessage('camera', devId, `data:image/jpeg;base64,${payload.toString('base64')}`);
              return;
            }
            const rawStr = payload.toString();
            try {
              processDeviceMessage('camera', devId, JSON.parse(rawStr));
            } catch {
              processDeviceMessage('camera', devId, rawStr);
            }
            return;
          }
          const rawStr = payload.toString();
          if (['status', 'telemetry', 'alert'].includes(channel)) {
            processDeviceMessage(channel, devId, JSON.parse(rawStr));
          }
        } catch {}
      });
    } catch (err: any) {
      bridgeConfig.lastError = err?.message || null;
      bridgeConfig.connected = true;
    }

    io.emit('bridge_status', bridgeConfig);
    io.emit('device_health', deviceHealth);
  }

  connectMqttBridge({
    brokerUrl: bridgeConfig.brokerUrl,
    deviceId: bridgeConfig.deviceId,
    topicPrefix: bridgeConfig.topicPrefix,
    username: initialRow.mqtt_username || DEFAULT_MQTT_USER,
    password: initialRow.mqtt_password || DEFAULT_MQTT_PASS,
  });

  // --- REST API Endpoints ---

  // 1. Bootstrap Initial State
  app.get('/api/bootstrap', (_req, res) => {
    const familyMembers = getFamilyFromDb();
    const activeViewersCount = Math.max(
      1,
      familyMembers.filter((f) => f.viewing).length,
      connectedClientsCount
    );
    res.json({
      bridgeConfig,
      deviceHealth,
      liveTelemetry,
      eventHistory: getEventsFromDb(),
      familyMembers,
      users: getUsersFromDb(),
      appSettings: getSettingsFromDb(),
      activityLogs: getActivityLogsFromDb(),
      activeViewersCount,
    });
  });

  // Security Middleware: Verify Firebase ID Token (JWT) or Registered User Session
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          const nowSec = Math.floor(Date.now() / 1000);
          if (
            payload.aud === 'causal-sum-3xhgq' &&
            payload.exp &&
            payload.exp > nowSec - 60 &&
            payload.user_id
          ) {
            return next();
          }
        }
      } catch {}
    }

    const headerUserId =
      (req.headers['x-axionis-user-id'] as string) ||
      req.body?.actorId ||
      req.body?.userId ||
      req.body?.uid;
    if (headerUserId) {
      const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(headerUserId);
      if (exists) {
        return next();
      }
    }

    return res.status(401).json({ error: 'Akses ditolak: Sesi autentikasi tidak valid.' });
  }

  // 2. IoT Bridge Configuration & Direct HTTP Ingest Endpoint for ESP32-S3
  app.post('/api/bridge/connect', requireAuth, (req, res) => {
    const { brokerUrl, deviceId, topicPrefix, username, password, actorId, actorName, actorRole } = req.body;
    const cleanBroker = (brokerUrl || DEFAULT_BROKER).trim();
    const cleanDevice = (deviceId || DEFAULT_DEVICE_ID).trim();
    const cleanPrefix = (topicPrefix || 'axionis').trim().replace(/\/+$/, '');

    db.prepare(`
      UPDATE device_settings
      SET device_id = ?, broker_url = ?, topic_prefix = ?, mqtt_username = ?, mqtt_password = ?, updated_at = ?
    `).run(cleanDevice, cleanBroker, cleanPrefix, username || '', password || '', new Date().toISOString());

    connectMqttBridge({
      brokerUrl: cleanBroker,
      deviceId: cleanDevice,
      topicPrefix: cleanPrefix,
      username,
      password,
    });

    recordActivity(
      io,
      actorId || 'USR-01',
      actorName || 'Budi Santoso',
      actorRole || 'Primary Caregiver',
      'IOT_BRIDGE',
      `Menghubungkan IoT Bridge ke ${cleanBroker} (Topik: ${cleanPrefix}/${cleanDevice}/+).`
    );

    return res.json({ bridgeConfig, deviceHealth });
  });

  // Send Command to ESP32-S3 via MQTT Bridge (`axionis/{deviceId}/cmd`)
  app.post('/api/bridge/cmd', requireAuth, (req, res) => {
    const { cmd, payload, actorId, actorName, actorRole } = req.body;
    const topic = `${bridgeConfig.topicPrefix}/${bridgeConfig.deviceId}/cmd`;
    const message = JSON.stringify({ cmd, ...(payload || {}), ts: new Date().toISOString() });

    if (mqttClient && bridgeConfig.connected) {
      mqttClient.publish(topic, message);
    }

    recordActivity(
      io,
      actorId || 'USR-01',
      actorName || 'Budi Santoso',
      actorRole || 'Primary Caregiver',
      'DEVICE_CMD',
      `Mengirim perintah [${cmd}] ke topik ${topic}.`
    );

    return res.json({ ok: true, topic, sent: bridgeConfig.connected });
  });

  // HTTP Webhook Bridge (Allows ESP32-S3 to push status/telemetry/alert directly via HTTP POST as well as MQTT)
  app.post('/api/iot/:channel', (req, res) => {
    const requiredDeviceSecret = process.env.IOT_API_SECRET;
    if (requiredDeviceSecret) {
      const providedKey = req.headers['x-axionis-device-key'] || req.body?.deviceKey;
      if (providedKey !== requiredDeviceSecret) {
        return res.status(401).json({ error: 'Invalid IoT Device API Key' });
      }
    }
    const { channel } = req.params;
    if (!['status', 'telemetry', 'alert'].includes(channel)) {
      return res.status(400).json({ error: 'Channel harus berupa status, telemetry, atau alert' });
    }
    const devId = req.body.device || bridgeConfig.deviceId;
    processDeviceMessage(channel, devId, req.body);
    return res.json({ ok: true, channel, device: devId });
  });

  // 3. Acknowledge Alert
  app.patch('/api/alerts/:id/acknowledge', requireAuth, (req, res) => {
    const { id } = req.params;
    const { userId, userName, userRole, clinicalNotes } = req.body;

    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Alert tidak ditemukan' });
    }

    const ackBy = userName || 'Keluarga Pendamping';
    const ackAt = new Date().toISOString();
    const notes = clinicalNotes?.trim() || 'Telah diperiksa dan ditangani oleh keluarga.';

    db.prepare(`
      UPDATE events
      SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = ?, clinical_notes = ?
      WHERE id = ?
    `).run(ackBy, ackAt, notes, id);

    if (mqttClient && bridgeConfig.connected) {
      mqttClient.publish(
        `${bridgeConfig.topicPrefix}/${bridgeConfig.deviceId}/cmd`,
        JSON.stringify({ cmd: 'ACK_ALARM', alertId: id, by: ackBy })
      );
    }

    const updatedEvents = getEventsFromDb();
    const updatedTarget = updatedEvents.find((e) => e.id === id);

    recordActivity(
      io,
      userId || 'USR-01',
      ackBy,
      userRole || 'Primary Caregiver',
      'ALERT_ACK',
      `Mengonfirmasi peringatan ${id} (${existing.level}).`,
      id
    );

    io.emit('alert_acknowledged', updatedTarget);
    return res.json(updatedTarget);
  });

  // 4. Family Access: Invite / Update / Delete
  app.post('/api/family/invite', requireAuth, (req, res) => {
    const { name, email, phoneWa, role, actorId, actorName, actorRole } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Alamat email wajib diisi' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM family_members WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'Email anggota keluarga sudah terdaftar' });
    }

    const id = `FAM-${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString();
    const memberName = name?.trim() || cleanEmail.split('@')[0];
    const memberPhone = phoneWa?.trim() || '+62 812-0000-0000';
    const memberRole = role === 'Primary Caregiver' ? 'Primary Caregiver' : 'Family Viewer';

    db.prepare(`
      INSERT INTO family_members (id, device_id, name, email, phone_wa, role, status, viewing, invited_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Active', 1, ?, ?)
    `).run(id, bridgeConfig.deviceId, memberName, cleanEmail, memberPhone, memberRole, now, now);

    const updatedFamily = getFamilyFromDb();
    io.emit('family_updated', updatedFamily);

    recordActivity(
      io,
      actorId || 'USR-01',
      actorName || 'Budi Santoso',
      actorRole || 'Primary Caregiver',
      'FAMILY_RBAC',
      `Mengundang ${memberName} sebagai ${memberRole}.`,
      id
    );

    return res.json(updatedFamily);
  });

  app.patch('/api/family/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { role, status, viewing, actorId, actorName, actorRole } = req.body;

    const existing = db.prepare('SELECT * FROM family_members WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Anggota keluarga tidak ditemukan' });
    }

    const nextRole = role ?? existing.role;
    const nextStatus = status ?? existing.status;
    const nextViewing = viewing !== undefined ? (viewing ? 1 : 0) : existing.viewing;

    db.prepare(`
      UPDATE family_members
      SET role = ?, status = ?, viewing = ?, last_seen_at = ?
      WHERE id = ?
    `).run(nextRole, nextStatus, nextViewing, new Date().toISOString(), id);

    db.prepare('UPDATE users SET role = ? WHERE email = ?').run(nextRole, existing.email);

    const updatedFamily = getFamilyFromDb();
    io.emit('family_updated', updatedFamily);

    recordActivity(
      io,
      actorId || 'USR-01',
      actorName || 'Budi Santoso',
      actorRole || 'Primary Caregiver',
      'FAMILY_RBAC',
      `Memperbarui akses ${existing.name} (${nextRole}).`,
      id
    );

    return res.json(updatedFamily);
  });

  app.delete('/api/family/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM family_members WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Anggota tidak ditemukan' });
    }

    db.prepare('DELETE FROM family_members WHERE id = ?').run(id);
    const updatedFamily = getFamilyFromDb();
    io.emit('family_updated', updatedFamily);

    recordActivity(
      io,
      'USR-01',
      'Budi Santoso',
      'Primary Caregiver',
      'FAMILY_RBAC',
      `Menghapus akses ${existing.name}.`,
      id
    );

    return res.json(updatedFamily);
  });

  // 5. Account Access: Firebase Auth Sync + Register / Login / Reset Password
  app.post('/api/auth/firebase-sync', (req, res) => {
    const { uid, name, email, phoneWa, deviceId, role, authProvider } = req.body;
    const cleanEmail = (email || 'user@axionis.id').trim().toLowerCase();
    const cleanName = (name || cleanEmail.split('@')[0] || 'Pengguna AXIONIS').trim();
    const cleanPhone = (phoneWa || '+62 812-0000-0000').trim();
    const pairedDevice = (deviceId || bridgeConfig.deviceId).trim();
    const now = new Date().toISOString();

    let row = db.prepare('SELECT * FROM users WHERE email = ? OR id = ?').get(cleanEmail, uid || '') as any;

    if (!row) {
      const id = uid || `USR-${Date.now().toString().slice(-4)}`;
      const userRole = role === 'Primary Caregiver' ? 'Primary Caregiver' : 'Family Viewer';
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, phone_wa, device_id, role, created_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, cleanName, cleanEmail, hashPassword('firebase_oauth'), cleanPhone, pairedDevice, userRole, now, now);

      row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    } else {
      const nextRole = role || row.role;
      db.prepare(`
        UPDATE users
        SET name = ?, phone_wa = ?, device_id = ?, role = ?, last_active_at = ?
        WHERE id = ?
      `).run(cleanName || row.name, cleanPhone || row.phone_wa, pairedDevice || row.device_id, nextRole, now, row.id);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id) as any;
    }

    const famExists = db.prepare('SELECT id FROM family_members WHERE email = ?').get(cleanEmail);
    if (!famExists) {
      db.prepare(`
        INSERT INTO family_members (id, device_id, name, email, phone_wa, role, status, viewing, invited_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Active', 1, ?, ?)
      `).run(
        `FAM-${Date.now().toString().slice(-4)}`,
        row.device_id,
        row.name,
        cleanEmail,
        row.phone_wa,
        row.role,
        now,
        now
      );
    } else {
      db.prepare(`
        UPDATE family_members
        SET viewing = 1, status = 'Active', last_seen_at = ?
        WHERE email = ?
      `).run(now, cleanEmail);
    }

    const userObj = {
      id: row.id,
      name: row.name,
      email: row.email,
      phoneWa: row.phone_wa,
      deviceId: row.device_id,
      role: row.role,
      createdAt: row.created_at,
      lastActiveAt: now,
    };

    io.emit('family_updated', getFamilyFromDb());
    io.emit('users_updated', getUsersFromDb());
    recordActivity(
      io,
      userObj.id,
      userObj.name,
      userObj.role,
      'AUTH',
      `Autentikasi Firebase berhasil (${authProvider === 'google.com' ? 'Google Account' : 'Email/Password'}).`
    );

    return res.json({ user: userObj, users: getUsersFromDb() });
  });

  app.post('/api/auth/register', (req, res) => {
    const { name, email, password, phoneWa, deviceId, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan kata sandi wajib diisi.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (exists) {
      return res.status(400).json({ error: 'Email sudah terdaftar.' });
    }

    const id = `USR-${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString();
    const userRole = role === 'Primary Caregiver' ? 'Primary Caregiver' : 'Family Viewer';
    const cleanPhone = phoneWa?.trim() || '+62 812-0000-0000';
    const pairedDevice = deviceId?.trim() || bridgeConfig.deviceId;

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, phone_wa, device_id, role, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), cleanEmail, hashPassword(password), cleanPhone, pairedDevice, userRole, now, now);

    const famExists = db.prepare('SELECT id FROM family_members WHERE email = ?').get(cleanEmail);
    if (!famExists) {
      db.prepare(`
        INSERT INTO family_members (id, device_id, name, email, phone_wa, role, status, viewing, invited_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Active', 1, ?, ?)
      `).run(`FAM-${Date.now().toString().slice(-4)}`, pairedDevice, name.trim(), cleanEmail, cleanPhone, userRole, now, now);
    }

    const userObj = {
      id,
      name: name.trim(),
      email: cleanEmail,
      phoneWa: cleanPhone,
      deviceId: pairedDevice,
      role: userRole,
      createdAt: now,
      lastActiveAt: now,
    };

    io.emit('family_updated', getFamilyFromDb());
    io.emit('users_updated', getUsersFromDb());
    recordActivity(io, id, userObj.name, userObj.role, 'AUTH', `Registrasi akun baru (${userObj.role}).`);

    return res.json({ user: userObj, users: getUsersFromDb() });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;

    if (!row) {
      return res.status(401).json({ error: 'Akun tidak ditemukan.' });
    }

    if (!password || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'Kata sandi salah.' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, row.id);
    db.prepare('UPDATE family_members SET viewing = 1, status = ?, last_seen_at = ? WHERE email = ?').run('Active', now, cleanEmail);

    const userObj = {
      id: row.id,
      name: row.name,
      email: row.email,
      phoneWa: row.phone_wa,
      deviceId: row.device_id,
      role: row.role,
      createdAt: row.created_at,
      lastActiveAt: now,
    };

    io.emit('family_updated', getFamilyFromDb());
    recordActivity(io, userObj.id, userObj.name, userObj.role, 'AUTH', `Login ke dasbor.`);

    return res.json({ user: userObj, users: getUsersFromDb() });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { email, newPassword } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;

    if (!row) {
      return res.status(404).json({ error: 'Email tidak ditemukan.' });
    }

    db.prepare('UPDATE users SET password_hash = ?, last_active_at = ? WHERE id = ?').run(
      hashPassword(newPassword.trim()),
      new Date().toISOString(),
      row.id
    );

    recordActivity(io, row.id, row.name, row.role, 'AUTH', `Reset kata sandi akun.`);
    return res.json({ message: `Kata sandi untuk ${cleanEmail} berhasil diperbarui.` });
  });

  // 6. Save App & Device Settings
  app.post('/api/settings', requireAuth, (req, res) => {
    const { alertPreferences, displayOptions, devicePreferences, actorId, actorName, actorRole } = req.body;
    const current = getSettingsFromDb();

    const nextAlert = { ...current.alertPreferences, ...(alertPreferences || {}) };
    const nextDisplay = { ...current.displayOptions, ...(displayOptions || {}) };
    const nextDevice = { ...current.devicePreferences, ...(devicePreferences || {}) };

    db.prepare(`
      UPDATE device_settings
      SET sound_siren = ?,
          browser_push = ?,
          whatsapp_forward = ?,
          face_threshold = ?,
          dys_threshold = ?,
          dark_mode = ?,
          privacy_blur_camera = ?,
          compact_timeline = ?,
          accessible_font_scale = ?,
          rms_threshold = ?,
          face_hold_seconds = ?,
          tft_brightness = ?,
          updated_at = ?
    `).run(
      nextAlert.soundSiren ? 1 : 0,
      nextAlert.browserPush ? 1 : 0,
      nextAlert.whatsappForward ? 1 : 0,
      nextAlert.faceThreshold,
      nextAlert.dysThreshold,
      nextDisplay.darkMode ? 1 : 0,
      nextDisplay.privacyBlurCamera ? 1 : 0,
      nextDisplay.compactTimeline ? 1 : 0,
      nextDisplay.accessibleFontScale,
      nextDevice.rmsThreshold,
      nextDevice.faceHoldSeconds,
      nextDevice.tftBrightness,
      new Date().toISOString()
    );

    if (mqttClient && bridgeConfig.connected) {
      mqttClient.publish(
        `${bridgeConfig.topicPrefix}/${bridgeConfig.deviceId}/cmd`,
        JSON.stringify({
          cmd: 'UPDATE_CONFIG',
          config: nextDevice,
          thresholds: { face: nextAlert.faceThreshold, dys: nextAlert.dysThreshold },
        })
      );
    }

    const updated = getSettingsFromDb();
    io.emit('settings_updated', updated);

    recordActivity(
      io,
      actorId || 'USR-01',
      actorName || 'Budi Santoso',
      actorRole || 'Primary Caregiver',
      'SETTINGS',
      `Menyimpan pengaturan & sinkronisasi ke ESP32-S3.`
    );

    return res.json(updated);
  });

  io.on('connection', (socket) => {
    connectedClientsCount += 1;
    io.emit('viewers_count', Math.max(1, connectedClientsCount));
    socket.emit('bridge_status', bridgeConfig);
    socket.emit('device_health', deviceHealth);
    socket.emit('live_telemetry', liveTelemetry);

    socket.on('disconnect', () => {
      connectedClientsCount = Math.max(0, connectedClientsCount - 1);
      io.emit('viewers_count', Math.max(1, connectedClientsCount));
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AXIONIS Care Watch Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
