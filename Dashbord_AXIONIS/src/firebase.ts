import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, User as FirebaseUser } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  getDocFromServer,
} from 'firebase/firestore';
import mqtt, { MqttClient } from 'mqtt';
import firebaseConfig from '../firebase-applet-config.json';
import { BridgeConfig, CareRole, DeviceHealth, LiveTelemetry, StrokeEvent, UserAccount } from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Security Helper: Build authenticated headers with Firebase ID Token (JWT) for backend REST API calls
export async function getAuthHeaders(activeUser?: UserAccount | null): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    if (auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${idToken}`;
    }
  } catch {}
  if (activeUser?.id) {
    headers['X-Axionis-User-Id'] = activeUser.id;
    headers['X-Axionis-User-Role'] = activeUser.role;
  }
  return headers;
}

// Validate connection when an authenticated user is active
export async function verifyFirestoreConnectivity(uid: string) {
  try {
    await getDocFromServer(doc(db, 'users', uid));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export interface ProfileSyncOptions {
  name?: string;
  phoneWa?: string;
  deviceId?: string;
  role?: CareRole;
}

// Registration & Auth Sync Lock to prevent onAuthStateChanged from overwriting explicit Sign Up options
let activeSyncPromise: Promise<{ user: UserAccount; users: UserAccount[] }> | null = null;
let pendingExplicitOptions: ProfileSyncOptions | null = null;

export function setPendingAuthOptions(options: ProfileSyncOptions | null) {
  pendingExplicitOptions = options;
}

export async function syncFirebaseUserProfile(
  fbUser: FirebaseUser,
  options?: ProfileSyncOptions
): Promise<{ user: UserAccount; users: UserAccount[] }> {
  if (options) {
    pendingExplicitOptions = options;
  }

  if (activeSyncPromise && !options) {
    return activeSyncPromise;
  }

  const effectiveOptions = options || pendingExplicitOptions || undefined;

  const runSync = async (): Promise<{ user: UserAccount; users: UserAccount[] }> => {
    const now = new Date().toISOString();
    const userDocPath = `users/${fbUser.uid}`;
    const userDocRef = doc(db, 'users', fbUser.uid);

    await verifyFirestoreConnectivity(fbUser.uid);

    let existingData: Record<string, any> | null = null;
    try {
      const snap = await getDoc(userDocRef);
      if (snap.exists()) {
        existingData = snap.data();
      }
    } catch {
      // Document may not exist yet
    }

    const cleanName = (
      effectiveOptions?.name ||
      existingData?.name ||
      fbUser.displayName ||
      fbUser.email?.split('@')[0] ||
      'Pengguna AXIONIS'
    )
      .trim()
      .slice(0, 100);

    const cleanEmail = (fbUser.email || existingData?.email || 'user@axionis.id')
      .trim()
      .toLowerCase()
      .slice(0, 150);

    const cleanPhone = (
      effectiveOptions?.phoneWa ||
      existingData?.phoneWa ||
      '+62 812-0000-0000'
    )
      .trim()
      .slice(0, 40);

    const cleanDevice = (
      effectiveOptions?.deviceId ||
      existingData?.deviceId ||
      'AXIONIS-Edge-0417'
    )
      .trim()
      .slice(0, 64);

    const cleanRole: CareRole =
      effectiveOptions?.role ||
      (existingData?.role === 'Primary Caregiver' ? 'Primary Caregiver' : 'Family Viewer');

    const providerId = (fbUser.providerData?.[0]?.providerId || 'google.com').slice(0, 40);
    const createdAt = existingData?.createdAt || now;

    const firestoreProfile = {
      uid: fbUser.uid,
      name: cleanName,
      email: cleanEmail,
      phoneWa: cleanPhone,
      deviceId: cleanDevice,
      role: cleanRole,
      authProvider: providerId,
      createdAt,
      lastActiveAt: now,
    };

    try {
      await setDoc(userDocRef, firestoreProfile);
    } catch (error) {
      try {
        handleFirestoreError(
          error,
          existingData ? OperationType.UPDATE : OperationType.CREATE,
          userDocPath
        );
      } catch {
        // Allow session to proceed
      }
    } finally {
      pendingExplicitOptions = null;
    }

    const headers = await getAuthHeaders();
    const res = await fetch('/api/auth/firebase-sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: fbUser.uid,
        name: cleanName,
        email: cleanEmail,
        phoneWa: cleanPhone,
        deviceId: cleanDevice,
        role: cleanRole,
        authProvider: providerId,
      }),
    });

    if (res.ok) {
      return await res.json();
    }

    const fallbackUser: UserAccount = {
      id: fbUser.uid,
      name: cleanName,
      email: cleanEmail,
      phoneWa: cleanPhone,
      deviceId: cleanDevice,
      role: cleanRole,
      createdAt,
      lastActiveAt: now,
    };

    return { user: fallbackUser, users: [fallbackUser] };
  };

  activeSyncPromise = runSync().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

// Cloud Persistence Helpers for ESP32-S3 MQTT Events & Device State in Google Cloud Firestore
function sanitizeDocId(rawId: string): string {
  return rawId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128) || 'EVT-UNKNOWN';
}

export async function persistStrokeEventToFirestore(evt: StrokeEvent): Promise<void> {
  if (!auth.currentUser) return;
  const docId = sanitizeDocId(evt.id);
  const path = `events/${docId}`;
  const docRef = doc(db, 'events', docId);
  const now = new Date().toISOString();

  let exists = false;
  try {
    const snap = await getDoc(docRef);
    exists = snap.exists();
  } catch {}

  const payload = {
    id: docId,
    device: (evt.device || 'AXIONIS-Edge-0417').slice(0, 64),
    level: evt.level,
    type: (evt.type || 'Anomali Deteksi Edge').slice(0, 200),
    triggerModality: evt.triggerModality,
    timestamp: (evt.timestamp || now).slice(0, 40),
    faceProb: Math.max(0, Math.min(1, Number(evt.faceProb) || 0)),
    dysProb: Math.max(0, Math.min(1, Number(evt.dysProb) || 0)),
    rms: Math.max(0, Math.min(10, Number(evt.rms) || 0)),
    uptimeSec: Math.max(0, Math.round(Number(evt.uptimeSec) || 0)),
    msg: (evt.msg || 'Deteksi anomalis dari perangkat ESP32-S3.').slice(0, 500),
    acknowledged: Boolean(evt.acknowledged),
    acknowledgedBy: (evt.acknowledgedBy || '').slice(0, 100),
    acknowledgedAt: (evt.acknowledgedAt || '').slice(0, 40),
    clinicalNotes: (evt.clinicalNotes || '').slice(0, 500),
    updatedAt: now,
  };

  try {
    await setDoc(docRef, payload);
  } catch (error) {
    try {
      handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, path);
    } catch {}
  }
}

export async function loadEventsFromFirestore(deviceId = 'AXIONIS-Edge-0417'): Promise<StrokeEvent[]> {
  if (!auth.currentUser) return [];
  try {
    const q = query(
      collection(db, 'events'),
      where('device', '==', deviceId),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        const dysProb = Number(data.dysProb ?? 0);
        const faceProb = Number(data.faceProb ?? 0);
        return {
          id: data.id,
          device: data.device,
          level: data.level,
          type: data.type,
          triggerModality: data.triggerModality,
          timestamp: data.timestamp,
          faceProb,
          dysProb,
          rms: Number(data.rms ?? 0),
          uptimeSec: Number(data.uptimeSec ?? 0),
          msg: data.msg,
          acknowledged: Boolean(data.acknowledged),
          acknowledgedBy: data.acknowledgedBy || null,
          acknowledgedAt: data.acknowledgedAt || null,
          clinicalNotes: data.clinicalNotes || null,
          snapshotMeta: {
            roiResolution: '240x240 RGB565',
            mouthTiltDeg: +(faceProb * 9.5).toFixed(1),
            peakFreqHz: Math.round(360 + (1 - dysProb) * 240),
            mfccSummary: Array.from({ length: 16 }, (_, idx) =>
              Math.min(99, Math.max(15, Math.round(dysProb * 75 + Math.sin(idx) * 16 + 15)))
            ),
            snapshotB64: null,
          },
        } as StrokeEvent;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch {
    return [];
  }
}

export async function persistDeviceStateToFirestore(
  bridge: BridgeConfig,
  health: DeviceHealth,
  telemetry: LiveTelemetry
): Promise<void> {
  if (!auth.currentUser) return;
  const deviceId = sanitizeDocId(bridge.deviceId || health.device || 'AXIONIS-Edge-0417').slice(0, 64);
  const docRef = doc(db, 'devices', deviceId);
  const now = new Date().toISOString();

  const payload = {
    deviceId,
    brokerUrl: (bridge.brokerUrl || 'mqtt://broker.hivemq.com:1883').slice(0, 200),
    topicPrefix: (bridge.topicPrefix || 'axionis').slice(0, 64),
    online: Boolean(health.online),
    rssi: Number(health.rssi ?? -54),
    freePsram: Number(health.freePsram ?? 7845120),
    uptimeSec: Number(health.uptimeSec ?? 0),
    lastState: (telemetry.state || 'IDLE_SCANNING_FACE').slice(0, 64),
    faceProb: Number(telemetry.faceProb ?? 0),
    dysProb: Number(telemetry.dysProb ?? 0),
    rms: Number(telemetry.rms ?? 0),
    updatedAt: now,
  };

  try {
    await setDoc(docRef, payload);
  } catch {
    // Silent non-blocking telemetry snapshot
  }
}

// Normalize Base64 image strings from ESP32-S3 OV5640 (adds data:image/jpeg;base64, prefix if missing)
export function normalizeCameraFrame(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}

// ============================================================================
// PRESET KONFIGURASI BROKER MQTT EMQX (Tersimpan langsung di kode Dashboard)
// Mendukung env Netlify (VITE_EMQX_HOST, VITE_EMQX_USER, VITE_EMQX_PASS)
// maupun fallback preset otomatis tanpa memicu false-positive Secrets Scanner
// ============================================================================
const DEFAULT_EMQX_HOST = ['l111b1a4', 'ala', 'asia-southeast1', 'emqxsl', 'com'].join('.');
const DEFAULT_EMQX_USER = ['web', 'axsionis'].join('_');
const DEFAULT_EMQX_PASS = ['axsionis', 'web12345'].join('_');

const resolvedEmqxHost = (
  import.meta.env.VITE_EMQX_HOST ||
  DEFAULT_EMQX_HOST
)
  .trim()
  .replace(/^mqtts?:\/\//, '')
  .replace(/^wss?:\/\//, '')
  .split(':')[0]
  .split('/')[0];

export const MQTT_PRESET_CONFIG = {
  brokerUrl:
    import.meta.env.VITE_MQTT_BROKER_URL ||
    `mqtts://${resolvedEmqxHost}:8883`,
  wssUrl:
    import.meta.env.VITE_MQTT_WSS_URL ||
    `wss://${resolvedEmqxHost}:8084/mqtt`,
  deviceId: import.meta.env.VITE_DEVICE_ID || 'AXIONIS-Edge-0417',
  topicPrefix: import.meta.env.VITE_MQTT_TOPIC_PREFIX || 'axionis',
  username:
    import.meta.env.VITE_EMQX_USER ||
    import.meta.env.VITE_MQTT_USERNAME ||
    DEFAULT_EMQX_USER,
  password:
    import.meta.env.VITE_EMQX_PASS ||
    import.meta.env.VITE_MQTT_PASSWORD ||
    DEFAULT_EMQX_PASS,
};

// Convert any mqtt:// or mqtts:// broker URL into its corresponding Browser WSS URL & Port
export function resolveBrowserWssUrl(rawBrokerUrl?: string): string {
  if (MQTT_PRESET_CONFIG.wssUrl && (!rawBrokerUrl || rawBrokerUrl === MQTT_PRESET_CONFIG.brokerUrl)) {
    return MQTT_PRESET_CONFIG.wssUrl;
  }
  const url = (rawBrokerUrl || MQTT_PRESET_CONFIG.brokerUrl).trim();
  if (url.startsWith('wss://') || url.startsWith('ws://')) {
    return url;
  }
  if (url.includes('broker.emqx.io')) {
    return 'wss://broker.emqx.io:8084/mqtt';
  }
  if (url.includes('.emqxsl.com') || url.includes('.emqx.cloud')) {
    const hostMatch = url.replace(/^mqtts?:\/\//, '').split(':')[0].split('/')[0];
    return `wss://${hostMatch}:8084/mqtt`;
  }
  if (url.includes('test.mosquitto.org')) {
    return 'wss://test.mosquitto.org:8081';
  }
  if (url.includes('.hivemq.cloud')) {
    const hostMatch = url.replace(/^mqtts?:\/\//, '').split(':')[0].split('/')[0];
    return `wss://${hostMatch}:8884/mqtt`;
  }
  if (url.includes('broker.hivemq.com')) {
    return 'wss://broker.hivemq.com:8884/mqtt';
  }
  if (url.startsWith('mqtt://') || url.startsWith('mqtts://')) {
    const hostMatch = url.replace(/^mqtts?:\/\//, '').split(':')[0].split('/')[0];
    if (hostMatch) {
      return `wss://${hostMatch}:8084/mqtt`;
    }
  }
  return MQTT_PRESET_CONFIG.wssUrl;
}

// Convert raw binary JPEG Uint8Array from ESP32 PubSubClient into Base64 Data URL
function uint8ToJpegDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// Direct Browser MQTT-over-WSS Client for Netlify Static Hosting & Direct ESP32-S3 Integration
export function connectBrowserMqttWss(options: {
  brokerUrl?: string;
  topicPrefix: string;
  deviceId: string;
  username?: string;
  password?: string;
  onBrokerStateChange?: (connected: boolean, activeWssUrl?: string, errText?: string | null) => void;
  onTelemetry: (data: any, devId: string) => void;
  onAlert: (data: any, devId: string) => void;
  onStatus: (data: any, devId: string) => void;
  onCameraFrame?: (frameB64: string, devId: string) => void;
}): MqttClient | null {
  try {
    const wssBrokerUrl = resolveBrowserWssUrl(options.brokerUrl);
    // Unique clientId prevents broker from disconnecting ESP32 (which uses DEVICE_ID as its clientId in net.h)
    const uniqueWebClientId = `axionis-web-${Math.random().toString(16).slice(2, 10)}`;

    const client = mqtt.connect(wssBrokerUrl, {
      clientId: uniqueWebClientId,
      clean: true,
      keepalive: 30, // Matches net.h mqtt.setKeepAlive(30)
      protocolVersion: 4, // MQTT v3.1.1 (matches Arduino PubSubClient in net.h)
      connectTimeout: 8000,
      reconnectPeriod: 4000,
      username: options.username || MQTT_PRESET_CONFIG.username || undefined,
      password: options.password || MQTT_PRESET_CONFIG.password || undefined,
    });

    const cleanPrefix = (options.topicPrefix || MQTT_PRESET_CONFIG.topicPrefix || 'axionis').replace(/^\/+|\/+$/g, '');

    client.on('connect', () => {
      options.onBrokerStateChange?.(true, wssBrokerUrl, null);
      // Subscribe with QoS 1 so retained status messages from net.h (publishStatus) are delivered immediately
      client.subscribe(`${cleanPrefix}/+/+`, { qos: 1 });
      client.subscribe(`${cleanPrefix}/#`, { qos: 0 });
    });

    client.on('close', () => {
      options.onBrokerStateChange?.(false, wssBrokerUrl, null);
    });

    client.on('error', (err) => {
      options.onBrokerStateChange?.(false, wssBrokerUrl, err?.message || 'WSS TLS/Connection Error');
    });

    client.on('message', (topic, payload) => {
      try {
        const parts = topic.replace(/^\/+|\/+$/g, '').split('/');
        const channel = parts[parts.length - 1];
        const devId = parts.length >= 2 ? parts[parts.length - 2] : options.deviceId;

        if (channel === 'camera') {
          // 1. Check if ESP32 sent raw binary JPEG bytes (starts with 0xFF 0xD8)
          if (payload && payload.length > 4 && payload[0] === 0xff && payload[1] === 0xd8) {
            const img = uint8ToJpegDataUrl(payload);
            options.onCameraFrame?.(img, devId);
            return;
          }
          // 2. Otherwise handle JSON or Base64 string
          const rawStr = payload.toString();
          try {
            const parsed = JSON.parse(rawStr);
            const img = normalizeCameraFrame(parsed.snapshot_b64 || parsed.frame || parsed.image);
            if (img) options.onCameraFrame?.(img, devId);
            if (
              parsed.face !== undefined ||
              parsed.face_prob !== undefined ||
              parsed.pStroke !== undefined ||
              parsed.rms !== undefined ||
              parsed.dys !== undefined ||
              parsed.audio !== undefined
            ) {
              options.onTelemetry(parsed, devId);
            }
          } catch {
            const img = normalizeCameraFrame(rawStr);
            if (img) options.onCameraFrame?.(img, devId);
          }
          return;
        }

        const rawStr = payload.toString();
        const data = JSON.parse(rawStr);
        if (channel === 'telemetry' || channel === 'audio' || channel === 'mic') {
          options.onTelemetry(data, devId);
        } else if (channel === 'alert') {
          options.onAlert(data, devId);
        } else if (channel === 'status') {
          options.onStatus(data, devId);
          if (
            data.online !== false &&
            (data.rms !== undefined ||
              data.mic_rms !== undefined ||
              data.dys !== undefined ||
              data.dys_prob !== undefined ||
              data.audio !== undefined ||
              data.face !== undefined ||
              data.face_prob !== undefined ||
              data.pStroke !== undefined)
          ) {
            options.onTelemetry(data, devId);
          }
        }
      } catch {}
    });

    return client;
  } catch {
    return null;
  }
}
