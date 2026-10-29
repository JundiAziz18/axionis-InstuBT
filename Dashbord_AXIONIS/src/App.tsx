import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Video,
  Mic,
  Bell,
  ShieldCheck,
  History,
  Users,
  UserCheck,
  Settings,
  Wifi,
  Cpu,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Filter,
  Camera,
  Lock,
  LogOut,
  Send,
  Sliders,
  Download,
  Volume2,
  VolumeX,
  RefreshCw,
  Trash2,
  Search,
  Eye,
  EyeOff,
  Radio,
  Link2,
  Copy,
  Menu,
  X,
  Palette,
  Activity,
} from 'lucide-react';
import {
  BootstrapPayload,
  BridgeConfig,
  DeviceHealth,
  LiveTelemetry,
  StrokeEvent,
  FamilyMember,
  UserAccount,
  AppSettings,
  ActivityLogItem,
  CareRole,
  MachineState,
} from './types';
import { LiveCameraViewport, AudioWaveformBar } from './components/SyntheticMonitorCanvas';
import { DetectionHistoryChart } from './components/DetectionHistoryChart';
import { AuthGateway } from './components/AuthGateway';
import { onAuthStateChanged, signOut, signInWithPopup } from 'firebase/auth';
import {
  auth,
  googleProvider,
  syncFirebaseUserProfile,
  persistStrokeEventToFirestore,
  loadEventsFromFirestore,
  persistDeviceStateToFirestore,
  getAuthHeaders,
  connectBrowserMqttWss,
  normalizeCameraFrame,
  resolveBrowserWssUrl,
  MQTT_PRESET_CONFIG,
} from './firebase';

type ModuleId =
  | 'live_monitor'
  | 'device_health'
  | 'event_history'
  | 'family_access'
  | 'account_access'
  | 'app_settings';

type ColorPresetId = 'graphite_sage' | 'nordic_slate' | 'warm_alabaster';

const SESSION_STORAGE_KEY = 'axionis_active_user_v1';
const THEME_STORAGE_KEY = 'axionis_color_preset_v1';
const EVENTS_STORAGE_KEY = 'axionis_event_history_v1';

function loadSavedEventsFromLocal(): StrokeEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StrokeEvent[]) : [];
  } catch {
    return [];
  }
}

function saveEventsToLocal(list: StrokeEvent[]) {
  try {
    // Store without heavy base64 strings inside localStorage to avoid quota limits
    const slim = list.slice(0, 100).map((e) => ({
      ...e,
      snapshotMeta: e.snapshotMeta ? { ...e.snapshotMeta, snapshotB64: null } : e.snapshotMeta,
    }));
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(slim));
  } catch {}
}

function mergeAndSortEvents(...lists: StrokeEvent[][]): StrokeEvent[] {
  const map = new Map<string, StrokeEvent>();
  lists.forEach((list) => {
    list.forEach((evt) => {
      if (evt && evt.id) {
        map.set(evt.id, evt);
      }
    });
  });
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function formatWibTime(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return (
    d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
    ' WIB'
  );
}

function formatRelativeSeconds(isoString: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
  if (diffSec <= 5) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} mnt lalu`;
  return `${Math.floor(mins / 60)} jam lalu`;
}

function getPipelineNotificationMeta(
  state: MachineState,
  telemetry: LiveTelemetry,
  holdTargetSec: number
): { title: string; detail: string; stepIndex: number } {
  switch (state) {
    case 'IDLE_SCANNING_FACE':
      return {
        title: 'Scan Face',
        detail: telemetry.faceDetected
          ? `Wajah terdeteksi (${(telemetry.faceProb * 100).toFixed(0)}%)`
          : 'Memindai wajah pada sensor OV5640...',
        stepIndex: 1,
      };
    case 'FACE_HOLD_3S':
      return {
        title: `Hold Face (${holdTargetSec}s)`,
        detail: `Menahan fokus wajah ${telemetry.holdElapsedSec.toFixed(1)}s / ${holdTargetSec}s`,
        stepIndex: 2,
      };
    case 'RECORDING_AUDIO_2S':
      return {
        title: 'Hold Audio 2s',
        detail: `Merekam suara INMP441 (${telemetry.audioRecordSec.toFixed(1)}s) · RMS ${telemetry.rms.toFixed(4)}`,
        stepIndex: 3,
      };
    case 'MFCC_CNN_INFERENCE':
      return {
        title: 'Inference',
        detail: 'Ekstraksi MFCC & inferensi CNN INT8 sedang berjalan...',
        stepIndex: 4,
      };
    case 'ALERT_NORMAL_RESULT':
      return {
        title: 'Result',
        detail: `Wajah ${(telemetry.faceProb * 100).toFixed(1)}% · Suara ${(telemetry.dysProb * 100).toFixed(1)}% · RMS ${telemetry.rms.toFixed(4)}`,
        stepIndex: 5,
      };
  }
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('live_monitor');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [showBridgeModal, setShowBridgeModal] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [pipelinePopupDismissed, setPipelinePopupDismissed] = useState<boolean>(false);
  const [hasReceivedLivePacket, setHasReceivedLivePacket] = useState<boolean>(false);
  const [hasLiveAudioPacket, setHasLiveAudioPacket] = useState<boolean>(false);
  const [wssBrokerConnected, setWssBrokerConnected] = useState<boolean>(false);
  const [activeWssUrl, setActiveWssUrl] = useState<string>(MQTT_PRESET_CONFIG.wssUrl);
  const [wssError, setWssError] = useState<string | null>(null);
  const [cameraFrameCount, setCameraFrameCount] = useState<number>(0);
  const [resyncCount, setResyncCount] = useState<number>(0);

  const lastCameraFrameAtRef = useRef<number>(0);
  const lastDevicePacketAtRef = useRef<number>(0);
  const lastAudioPacketAtRef = useRef<number>(0);

  // Curated Low-Fatigue Color Preset
  const [colorPreset, setColorPreset] = useState<ColorPresetId>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) as ColorPresetId | null;
      return saved || 'graphite_sage';
    } catch {
      return 'graphite_sage';
    }
  });

  // Authenticated User State
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserAccount) : null;
    } catch {
      return null;
    }
  });

  // IoT Bridge State (Uses Preset Broker from Code)
  const [bridge, setBridge] = useState<BridgeConfig>({
    brokerUrl: MQTT_PRESET_CONFIG.brokerUrl,
    deviceId: MQTT_PRESET_CONFIG.deviceId,
    username: MQTT_PRESET_CONFIG.username,
    topicPrefix: MQTT_PRESET_CONFIG.topicPrefix,
    connected: true,
    lastError: null,
  });

  // Fase 1: Live Monitor (Starts clean at 0 until ESP32 sends live telemetry)
  const [telemetry, setTelemetry] = useState<LiveTelemetry>({
    device: 'AXIONIS-Edge-0417',
    state: 'IDLE_SCANNING_FACE',
    stateProgress: 0,
    rms: 0,
    faceDetected: false,
    faceProb: 0,
    dysProb: 0,
    holdElapsedSec: 0.0,
    audioRecordSec: 0.0,
    mfccBins: Array.from({ length: 16 }, () => 0),
    waveform: Array.from({ length: 32 }, () => 0),
    snapshotB64: null,
    landmarkAsymmetry: {
      leftMouthDropMm: 0.0,
      rightMouthDropMm: 0.0,
      eyeApertureRatio: 1.0,
      yawDeg: 0.0,
    },
  });

  // Fase 2: Device Health
  const [health, setHealth] = useState<DeviceHealth>({
    device: 'AXIONIS-Edge-0417',
    online: true,
    rssi: -54,
    freePsram: 7845120,
    totalPsram: 8388608,
    freeSram: 384200,
    uptimeSec: 14520,
    ip: '192.168.1.42',
    lastSeen: new Date().toISOString(),
    mqttConnected: true,
    mqttBroker: 'mqtt://broker.emqx.io:1883',
  });

  // Pop-Up Alert Notification & Event History State (Persisted in LocalStorage + Backend + Firestore)
  const [events, setEvents] = useState<StrokeEvent[]>(() => loadSavedEventsFromLocal());
  const [emergencyModalEvent, setEmergencyModalEvent] = useState<StrokeEvent | null>(null);
  const [ackNotesInput, setAckNotesInput] = useState<string>('');
  const [sirenMutedSession, setSirenMutedSession] = useState<boolean>(false);

  // Fase 3 Filters
  const [historyLevelFilter, setHistoryLevelFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'NORMAL'>('ALL');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');

  // Fase 4: Family Access & Activity Logs
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [activeViewersCount, setActiveViewersCount] = useState<number>(1);

  const [inviteName, setInviteName] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<CareRole>('Family Viewer');

  // Fase 4: Account Access Module Sub-Tabs
  const [authTab, setAuthTab] = useState<'profile' | 'register' | 'reset'>('profile');
  const [regName, setRegName] = useState<string>('');
  const [regEmail, setRegEmail] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regRole, setRegRole] = useState<CareRole>('Family Viewer');
  const [resetEmail, setResetEmail] = useState<string>('');
  const [resetNewPassword, setResetNewPassword] = useState<string>('');

  // Fase 4: App Settings
  const [settings, setSettings] = useState<AppSettings>({
    deviceId: 'AXIONIS-Edge-0417',
    alertPreferences: {
      soundSiren: true,
      browserPush: true,
      whatsappForward: true,
      faceThreshold: 0.65,
      dysThreshold: 0.60,
    },
    displayOptions: {
      darkMode: true,
      privacyBlurCamera: false,
      compactTimeline: false,
      accessibleFontScale: 'normal',
    },
    devicePreferences: {
      rmsThreshold: 0.002,
      faceHoldSeconds: 3,
      tftBrightness: 90,
    },
  });

  const socketRef = useRef<Socket | null>(null);
  const wssClientRef = useRef<ReturnType<typeof connectBrowserMqttWss>>(null);
  const lastStateRef = useRef<MachineState>(telemetry.state);
  const lastAutoRecordMsRef = useRef<number>(0);
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3000);
  }, []);

  const handleSelectColorPreset = (preset: ColorPresetId) => {
    setColorPreset(preset);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preset);
    } catch {}
    const isLight = preset === 'warm_alabaster';
    setSettings((prev) => ({
      ...prev,
      displayOptions: { ...prev.displayOptions, darkMode: !isLight },
    }));
    showToast(
      preset === 'graphite_sage'
        ? 'Tema diterapkan: Calm Graphite & Soft Sage'
        : preset === 'nordic_slate'
        ? 'Tema diterapkan: Nordic Slate & Muted Sky'
        : 'Tema diterapkan: Warm Alabaster & Clinical Stone'
    );
  };

  const handleSetAuthenticatedUser = (user: UserAccount | null, updatedUsers?: UserAccount[]) => {
    setCurrentUser(user);
    if (updatedUsers) setUsersList(updatedUsers);
    try {
      if (user) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
        showToast(`Selamat datang, ${user.name} (${user.role})`);
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        signOut(auth).catch(() => {});
      }
    } catch {}
  };

  const sirenEnabledRef = useRef<boolean>(true);
  sirenEnabledRef.current = settings.alertPreferences.soundSiren && !sirenMutedSession;

  const playEmergencySirenBeep = useCallback((level: 'CRITICAL' | 'WARNING') => {
    if (!sirenEnabledRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = level === 'CRITICAL' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(level === 'CRITICAL' ? 880 : 620, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, []);

  // Helper to persist any new detection event to React State, LocalStorage, Backend SQLite, and Cloud Firestore
  const recordAndPersistDetection = useCallback(
    (newEvt: StrokeEvent, options?: { openModalIfAlert?: boolean; pushToBackend?: boolean }) => {
      setEvents((prev) => {
        const next = mergeAndSortEvents([newEvt], prev);
        saveEventsToLocal(next);
        return next;
      });
      persistStrokeEventToFirestore(newEvt).catch(() => {});

      if (options?.pushToBackend !== false) {
        fetch('/api/iot/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newEvt.id,
            device: newEvt.device,
            level: newEvt.level,
            type: newEvt.type,
            ts: newEvt.timestamp,
            face: newEvt.faceProb,
            dys: newEvt.dysProb,
            rms: newEvt.rms,
            uptime_ms: newEvt.uptimeSec * 1000,
            msg: newEvt.msg,
          }),
        }).catch(() => {});
      }

      if (
        options?.openModalIfAlert !== false &&
        (newEvt.level === 'CRITICAL' || newEvt.level === 'WARNING')
      ) {
        setEmergencyModalEvent(newEvt);
        playEmergencySirenBeep(newEvt.level);
      }
    },
    [playEmergencySirenBeep]
  );

  useEffect(() => {
    let mounted = true;

    fetch('/api/bootstrap')
      .then((r) => r.json())
      .then((data: BootstrapPayload) => {
        if (!mounted) return;
        setBridge({
          brokerUrl: MQTT_PRESET_CONFIG.brokerUrl,
          deviceId: data.bridgeConfig?.deviceId || MQTT_PRESET_CONFIG.deviceId,
          username: MQTT_PRESET_CONFIG.username,
          topicPrefix: MQTT_PRESET_CONFIG.topicPrefix,
          connected: true,
          lastError: null,
        });
        setHealth((prev) => ({
          ...data.deviceHealth,
          mqttBroker: MQTT_PRESET_CONFIG.brokerUrl,
          ip: prev.ip !== '192.168.1.42' ? prev.ip : data.deviceHealth.ip,
          online: hasReceivedLivePacket ? true : Boolean(data.deviceHealth.online),
          mqttConnected: true,
        }));
        setEvents((prev) => {
          const merged = mergeAndSortEvents(prev, loadSavedEventsFromLocal(), data.eventHistory);
          saveEventsToLocal(merged);
          return merged;
        });
        setFamily(data.familyMembers);
        setUsersList(data.users);
        setSettings(data.appSettings);
        setActivityLogs(data.activityLogs);
        setActiveViewersCount(data.activeViewersCount);
        setIsLoading(false);
      })
      .catch(() => {
        if (mounted) setIsLoading(false);
      });

    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('bridge_status', (nextBridge: BridgeConfig) => {
      setBridge((prev) => ({
        ...nextBridge,
        brokerUrl: prev.brokerUrl || nextBridge.brokerUrl,
      }));
      if (nextBridge.connected) {
        setPipelinePopupDismissed(false);
      }
    });

    socket.on('device_health', (nextHealth: DeviceHealth) => {
      setHealth(nextHealth);
    });

    socket.on('live_telemetry', (nextTel: LiveTelemetry) => {
      lastDevicePacketAtRef.current = Date.now();
      if (nextTel.snapshotB64) {
        lastCameraFrameAtRef.current = Date.now();
      }
      if (nextTel.rms > 0 || nextTel.dysProb > 0) {
        lastAudioPacketAtRef.current = Date.now();
        setHasLiveAudioPacket(true);
      }
      setHasReceivedLivePacket(true);
      setTelemetry((prev) => ({
        ...nextTel,
        snapshotB64: nextTel.snapshotB64 ?? prev.snapshotB64,
      }));
      if (lastStateRef.current !== nextTel.state) {
        lastStateRef.current = nextTel.state;
        setPipelinePopupDismissed(false);
        persistDeviceStateToFirestore(bridge, health, nextTel).catch(() => {});
      }
    });

    socket.on('new_alert', (newEvt: StrokeEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === newEvt.id)) return prev;
        const next = mergeAndSortEvents([newEvt], prev);
        saveEventsToLocal(next);
        return next;
      });
      persistStrokeEventToFirestore(newEvt).catch(() => {});
      if (newEvt.level === 'CRITICAL' || newEvt.level === 'WARNING') {
        setEmergencyModalEvent(newEvt);
        playEmergencySirenBeep(newEvt.level);
      }
    });

    socket.on('alert_acknowledged', (updatedEvt: StrokeEvent) => {
      setEvents((prev) => {
        const next = prev.map((e) => (e.id === updatedEvt.id ? updatedEvt : e));
        saveEventsToLocal(next);
        return next;
      });
      setEmergencyModalEvent((prev) => (prev?.id === updatedEvt.id ? null : prev));
      persistStrokeEventToFirestore(updatedEvt).catch(() => {});
    });

    socket.on('family_updated', (updatedFamily: FamilyMember[]) => {
      setFamily(updatedFamily);
    });

    socket.on('users_updated', (updatedUsers: UserAccount[]) => {
      setUsersList(updatedUsers);
    });

    socket.on('settings_updated', (updatedSettings: AppSettings) => {
      setSettings(updatedSettings);
    });

    socket.on('activity_logged', (logItem: ActivityLogItem) => {
      setActivityLogs((prev) => {
        if (prev.some((item) => item.id === logItem.id)) return prev;
        return [logItem, ...prev.slice(0, 49)];
      });
    });

    socket.on('viewers_count', (cnt: number) => {
      setActiveViewersCount(cnt);
    });

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (!mounted || !fbUser) return;
      try {
        const synced = await syncFirebaseUserProfile(fbUser);
        if (!mounted) return;
        setCurrentUser(synced.user);
        setUsersList(synced.users);
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(synced.user));

        const cloudEvents = await loadEventsFromFirestore(synced.user.deviceId || 'AXIONIS-Edge-0417');
        if (mounted && cloudEvents.length > 0) {
          setEvents((prev) => {
            const merged = mergeAndSortEvents(prev, loadSavedEventsFromLocal(), cloudEvents);
            saveEventsToLocal(merged);
            return merged;
          });
        }
      } catch {}
    });

    return () => {
      mounted = false;
      unsubAuth();
      socket.disconnect();
    };
  }, [playEmergencySirenBeep]);

  // Reactive Browser MQTT-over-WSS Listener (Reconnects automatically when Broker URL, Topic Prefix, Auth, or Resync changes)
  useEffect(() => {
    let active = true;
    setActiveWssUrl(resolveBrowserWssUrl(bridge.brokerUrl));
    setWssError(null);

    if (wssClientRef.current) {
      try {
        wssClientRef.current.end(true);
      } catch {}
      wssClientRef.current = null;
    }

    const wssClient = connectBrowserMqttWss({
      brokerUrl: MQTT_PRESET_CONFIG.brokerUrl,
      topicPrefix: MQTT_PRESET_CONFIG.topicPrefix,
      deviceId: bridge.deviceId || MQTT_PRESET_CONFIG.deviceId,
      username: MQTT_PRESET_CONFIG.username || undefined,
      password: MQTT_PRESET_CONFIG.password || undefined,
      onBrokerStateChange: (isConn, resolvedUrl, errText) => {
        if (!active) return;
        setWssBrokerConnected(isConn);
        if (resolvedUrl) setActiveWssUrl(resolvedUrl);
        if (errText !== undefined) setWssError(errText);
        if (!isConn) {
          // Broker disconnected: immediately clear frozen camera frame
          setTelemetry((prev) => (prev.snapshotB64 ? { ...prev, snapshotB64: null } : prev));
        }
      },
      onCameraFrame: (frameB64, devId) => {
        if (!active) return;
        const nowMs = Date.now();
        lastCameraFrameAtRef.current = nowMs;
        lastDevicePacketAtRef.current = nowMs;
        setHasReceivedLivePacket(true);
        setCameraFrameCount((c) => c + 1);
        setBridge((prev) => ({
          ...prev,
          deviceId: devId || prev.deviceId,
          connected: true,
        }));
        setHealth((prev) => ({
          ...prev,
          device: devId || prev.device,
          online: true,
          lastSeen: new Date().toISOString(),
          mqttConnected: true,
        }));
        setTelemetry((prev) => ({
          ...prev,
          device: devId || prev.device,
          snapshotB64: frameB64,
        }));
      },
      onStatus: (data, devId) => {
        if (!active) return;
        const discoveredId = data.device || devId;

        // If ESP32 disconnects (MQTT LWT sends {"online": false}), immediately clear camera & live telemetry
        if (data.online === false) {
          lastCameraFrameAtRef.current = 0;
          lastDevicePacketAtRef.current = 0;
          lastAudioPacketAtRef.current = 0;
          setHasReceivedLivePacket(false);
          setHasLiveAudioPacket(false);
          setHealth((prev) => ({
            ...prev,
            device: discoveredId || prev.device,
            online: false,
            lastSeen: new Date().toISOString(),
          }));
          setTelemetry((prev) => ({
            ...prev,
            device: discoveredId || prev.device,
            state: 'IDLE_SCANNING_FACE',
            snapshotB64: null,
            faceDetected: false,
            faceProb: 0,
            dysProb: 0,
            rms: 0,
            holdElapsedSec: 0,
            audioRecordSec: 0,
            mfccBins: Array.from({ length: 16 }, () => 0),
            waveform: Array.from({ length: 32 }, () => 0),
          }));
          return;
        }

        lastDevicePacketAtRef.current = Date.now();
        setHasReceivedLivePacket(true);
        const uptimeFromMs =
          data.uptime_ms !== undefined ? Math.round(Number(data.uptime_ms) / 1000) : undefined;
        setBridge((prev) => ({
          ...prev,
          deviceId: discoveredId || prev.deviceId,
          connected: true,
        }));
        setHealth((prev) => ({
          ...prev,
          device: discoveredId,
          online: true,
          rssi: Number(data.rssi ?? prev.rssi),
          freePsram: Number(data.free_psram ?? data.freePsram ?? prev.freePsram),
          uptimeSec: Number(uptimeFromMs ?? data.uptime_s ?? data.uptimeSec ?? prev.uptimeSec),
          ip: data.ip || prev.ip,
          lastSeen: new Date().toISOString(),
          mqttConnected: true,
        }));
      },
      onTelemetry: (data, devId) => {
        if (!active) return;
        const nowMs = Date.now();
        lastDevicePacketAtRef.current = nowMs;
        setHasReceivedLivePacket(true);

        const rawRms = data.rms ?? data.mic_rms ?? data.audio_rms ?? data.inmp441_rms;
        const rawFace = data.face ?? data.face_prob ?? data.faceProb ?? data.pStroke ?? data.p_stroke;
        const rawDys =
          data.dys ??
          data.dys_prob ??
          data.dysProb ??
          data.audio ??
          data.audio_prob ??
          data.audioProb ??
          data.pAudio ??
          data.p_audio;
        const rawFound = data.face_detected ?? data.faceDetected ?? data.found;

        if (rawRms !== undefined || rawDys !== undefined) {
          lastAudioPacketAtRef.current = nowMs;
          setHasLiveAudioPacket(true);
        }

        const incomingFrame = normalizeCameraFrame(
          data.snapshot_b64 || data.snapshotB64 || data.frame || data.image || null
        );
        if (incomingFrame) {
          lastCameraFrameAtRef.current = nowMs;
          setCameraFrameCount((c) => c + 1);
        }

        setHealth((prev) => ({
          ...prev,
          device: devId || prev.device,
          online: true,
          lastSeen: new Date().toISOString(),
          mqttConnected: true,
        }));

        setTelemetry((prev) => {
          const rmsVal = rawRms !== undefined ? Math.max(0, Number(rawRms) || 0) : prev.rms;
          const faceProbVal =
            rawFace !== undefined ? Math.max(0, Math.min(1, Number(rawFace) || 0)) : prev.faceProb;
          const dysProbVal =
            rawDys !== undefined ? Math.max(0, Math.min(1, Number(rawDys) || 0)) : prev.dysProb;
          const faceDetectedVal =
            rawFound !== undefined ? Boolean(rawFound) : rawFace !== undefined ? faceProbVal > 0 : prev.faceDetected;

          const rawState = String(data.state || prev.state || 'IDLE_SCANNING_FACE').toUpperCase();
          let mappedState: MachineState = 'IDLE_SCANNING_FACE';
          if (rawState.includes('HOLD')) mappedState = 'FACE_HOLD_3S';
          else if (rawState.includes('RECORD') || rawState.includes('AUDIO')) mappedState = 'RECORDING_AUDIO_2S';
          else if (rawState.includes('MFCC') || rawState.includes('INFERENCE')) mappedState = 'MFCC_CNN_INFERENCE';
          else if (rawState.includes('ALERT') || rawState.includes('NORMAL')) mappedState = 'ALERT_NORMAL_RESULT';

          const phase = nowMs * 0.008;
          const nextMfcc = Array.isArray(data.mfcc_bins)
            ? data.mfcc_bins
            : Array.from({ length: 16 }, (_, idx) =>
                Math.max(
                  6,
                  Math.min(
                    98,
                    Math.round(
                      dysProbVal * 65 +
                        rmsVal * 2800 +
                        Math.abs(Math.sin(idx * 0.65 + phase)) * (rmsVal > 0.0002 ? 24 : 6)
                    )
                  )
                )
              );

          // Auto-record detection into Event History if threshold is exceeded or scan completed (with 15s cooldown)
          const faceThresh = settingsRef.current.alertPreferences.faceThreshold;
          const dysThresh = settingsRef.current.alertPreferences.dysThreshold;
          const isFaceHigh = faceProbVal >= faceThresh;
          const isDysHigh = dysProbVal >= dysThresh;
          const isResultState =
            mappedState === 'ALERT_NORMAL_RESULT' ||
            Boolean(data.save_history) ||
            Boolean(data.record);

          if (
            (isFaceHigh || isDysHigh || isResultState) &&
            nowMs - lastAutoRecordMsRef.current >= 15000
          ) {
            lastAutoRecordMsRef.current = nowMs;
            const autoLevel: 'CRITICAL' | 'WARNING' | 'NORMAL' =
              isFaceHigh && isDysHigh
                ? 'CRITICAL'
                : isFaceHigh || isDysHigh
                ? 'WARNING'
                : 'NORMAL';
            const autoModality: 'Multimodal' | 'Visual' | 'Audio' =
              isFaceHigh && isDysHigh ? 'Multimodal' : isFaceHigh ? 'Visual' : 'Audio';
            const autoType =
              autoLevel === 'CRITICAL'
                ? 'Multimodal (Facial Droop + Dysarthria)'
                : isFaceHigh
                ? 'Visual (Indikasi Asimetri Wajah)'
                : isDysHigh
                ? 'Audio (Indikasi Disartria Suara)'
                : 'Pemeriksaan Normal (Wajah & Suara)';
            const autoEvt: StrokeEvent = {
              id: `EVT-${new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`,
              device: devId || prev.device,
              level: autoLevel,
              type: autoType,
              triggerModality: autoModality,
              timestamp: new Date(nowMs).toISOString(),
              faceProb: faceProbVal,
              dysProb: dysProbVal,
              rms: rmsVal,
              uptimeSec: health.uptimeSec || 14520,
              msg:
                autoLevel === 'NORMAL'
                  ? `Pemeriksaan rutin normal: Wajah ${(faceProbVal * 100).toFixed(1)}%, Suara ${(dysProbVal * 100).toFixed(1)}%, RMS ${rmsVal.toFixed(4)}.`
                  : `Deteksi otomatis ESP32-S3: Wajah ${(faceProbVal * 100).toFixed(1)}%, Suara ${(dysProbVal * 100).toFixed(1)}%, RMS ${rmsVal.toFixed(4)}.`,
              acknowledged: autoLevel === 'NORMAL',
              acknowledgedBy: autoLevel === 'NORMAL' ? 'Auto-Monitor' : null,
              acknowledgedAt: autoLevel === 'NORMAL' ? new Date(nowMs).toISOString() : null,
              clinicalNotes: null,
              snapshotMeta: {
                roiResolution: '240x240 RGB565',
                mouthTiltDeg: +(faceProbVal * 9.5).toFixed(1),
                peakFreqHz: Math.round(360 + (1 - dysProbVal) * 240),
                mfccSummary: nextMfcc,
                snapshotB64: incomingFrame || prev.snapshotB64,
              },
            };
            setTimeout(() => {
              recordAndPersistDetection(autoEvt, {
                openModalIfAlert: autoLevel === 'CRITICAL' || autoLevel === 'WARNING',
                pushToBackend: true,
              });
            }, 0);
          }

          return {
            ...prev,
            device: devId || prev.device,
            state: mappedState,
            stateProgress: Number(data.progress ?? 100),
            rms: rmsVal,
            faceDetected: faceDetectedVal,
            faceProb: faceProbVal,
            dysProb: dysProbVal,
            holdElapsedSec: Number(data.hold_s ?? (mappedState === 'FACE_HOLD_3S' ? 3.0 : 0.0)),
            audioRecordSec: Number(data.audio_s ?? (mappedState === 'RECORDING_AUDIO_2S' ? 2.0 : 0.0)),
            mfccBins: nextMfcc,
            snapshotB64: incomingFrame || prev.snapshotB64,
            streamUrl: data.stream_url || data.streamUrl || prev.streamUrl,
          };
        });
      },
      onAlert: (data, devId) => {
        if (!active) return;
        const nowMs = Date.now();
        lastDevicePacketAtRef.current = nowMs;
        lastAudioPacketAtRef.current = nowMs;
        lastAutoRecordMsRef.current = nowMs;
        setHasReceivedLivePacket(true);
        setHasLiveAudioPacket(true);
        const faceProb = Number(data.face ?? data.face_prob ?? data.faceProb ?? data.pStroke ?? 0.85);
        const dysProb = Number(data.dys ?? data.dys_prob ?? data.dysProb ?? data.audio ?? 0.78);
        const rms = Number(data.rms ?? data.mic_rms ?? 0.021);
        const uptimeSec =
          data.uptime_ms !== undefined ? Math.round(Number(data.uptime_ms) / 1000) : 14520;
        let timestamp = new Date().toISOString();
        if (typeof data.ts === 'number' && data.ts > 1700000000) {
          timestamp = new Date(data.ts * 1000).toISOString();
        } else if (typeof data.ts === 'string' && data.ts.trim()) {
          timestamp = data.ts.trim();
        }
        const upperLevel = String(data.level || 'CRITICAL').toUpperCase();
        const level = (
          upperLevel === 'WARNING' || upperLevel === 'NORMAL' ? upperLevel : 'CRITICAL'
        ) as 'CRITICAL' | 'WARNING' | 'NORMAL';
        const newEvt: StrokeEvent = {
          id:
            data.id ||
            `EVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`,
          device: devId,
          level,
          type: data.type || (level === 'CRITICAL' ? 'Multimodal (Facial Droop + Dysarthria)' : 'Anomali Deteksi Edge'),
          triggerModality: faceProb >= 0.6 && dysProb >= 0.6 ? 'Multimodal' : faceProb >= 0.6 ? 'Visual' : 'Audio',
          timestamp,
          faceProb,
          dysProb,
          rms,
          uptimeSec,
          msg: data.msg || 'Indikasi kuat asimetri wajah dan/atau disartria terdeteksi oleh perangkat AXIONIS.',
          acknowledged: false,
          acknowledgedBy: null,
          acknowledgedAt: null,
          clinicalNotes: null,
          snapshotMeta: {
            roiResolution: '240x240 RGB565',
            mouthTiltDeg: +(faceProb * 9.5).toFixed(1),
            peakFreqHz: Math.round(360 + (1 - dysProb) * 240),
            mfccSummary: Array.from({ length: 16 }, (_, idx) =>
              Math.min(99, Math.max(15, Math.round(dysProb * 75 + Math.sin(idx) * 16 + 15)))
            ),
            snapshotB64: normalizeCameraFrame(data.snapshot_b64 || null),
          },
        };
        setTelemetry((prev) => ({
          ...prev,
          device: devId,
          state: 'ALERT_NORMAL_RESULT',
          faceProb,
          dysProb,
          rms,
          mfccBins: Array.from({ length: 16 }, (_, idx) =>
            Math.min(99, Math.max(15, Math.round(dysProb * 75 + rms * 2000 + Math.sin(idx) * 16 + 15)))
          ),
        }));
        recordAndPersistDetection(newEvt, { openModalIfAlert: true, pushToBackend: true });
      },
    });

    wssClientRef.current = wssClient;

    return () => {
      active = false;
      if (wssClient) {
        try {
          wssClient.end(true);
        } catch {}
      }
    };
  }, [resyncCount, playEmergencySirenBeep, recordAndPersistDetection]);

  // Watchdog Timer: Automatically clear frozen camera frame (>3.5s) and mark device offline (>6.5s) when ESP32 disconnects
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      // 1. If camera frames stop arriving for > 3.5 seconds, immediately clear snapshotB64 so image doesn't stay frozen
      if (lastCameraFrameAtRef.current > 0 && now - lastCameraFrameAtRef.current > 3500) {
        lastCameraFrameAtRef.current = 0;
        setTelemetry((prev) => (prev.snapshotB64 ? { ...prev, snapshotB64: null } : prev));
      }

      // 2. If audio packets stop arriving for > 5 seconds, clear live audio badge
      if (lastAudioPacketAtRef.current > 0 && now - lastAudioPacketAtRef.current > 5000) {
        lastAudioPacketAtRef.current = 0;
        setHasLiveAudioPacket(false);
      }

      // 3. If no MQTT packets (camera/telemetry/status) arrive from ESP32 for > 8 seconds, mark device offline
      if (lastDevicePacketAtRef.current > 0 && now - lastDevicePacketAtRef.current > 8000) {
        lastDevicePacketAtRef.current = 0;
        setHasReceivedLivePacket(false);
        setHasLiveAudioPacket(false);
        setHealth((prev) => (prev.online ? { ...prev, online: false } : prev));
        setTelemetry((prev) => ({
          ...prev,
          snapshotB64: null,
          faceDetected: false,
          faceProb: 0,
          dysProb: 0,
          rms: 0,
          mfccBins: Array.from({ length: 16 }, () => 0),
          waveform: Array.from({ length: 32 }, () => 0),
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!currentUser) {
    return (
      <AuthGateway
        defaultDeviceId={bridge.deviceId}
        onAuthenticated={(user, allUsers) => handleSetAuthenticatedUser(user, allUsers)}
      />
    );
  }

  // Connect / Sync IoT Bridge using Code Preset Config
  const handleAutoSyncBridge = async () => {
    const cleanBroker = MQTT_PRESET_CONFIG.brokerUrl;
    const cleanDevice = currentUser.deviceId || bridge.deviceId || MQTT_PRESET_CONFIG.deviceId;
    const cleanPrefix = MQTT_PRESET_CONFIG.topicPrefix;

    setBridge({
      brokerUrl: cleanBroker,
      deviceId: cleanDevice,
      username: MQTT_PRESET_CONFIG.username,
      topicPrefix: cleanPrefix,
      connected: true,
      lastError: null,
    });
    setHealth((prev) => ({
      ...prev,
      device: cleanDevice,
      mqttBroker: cleanBroker,
      online: true,
      mqttConnected: true,
    }));

    // Reconnect Browser MQTT-over-WSS client & request status
    setResyncCount((c) => c + 1);
    setPipelinePopupDismissed(false);
    setShowBridgeModal(false);
    showToast(`Bridge disinkronkan ke ${MQTT_PRESET_CONFIG.wssUrl} (${cleanPrefix}/${cleanDevice})`);

    try {
      const headers = await getAuthHeaders(currentUser);
      await fetch('/api/bridge/connect', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          brokerUrl: cleanBroker,
          deviceId: cleanDevice,
          topicPrefix: cleanPrefix,
          username: MQTT_PRESET_CONFIG.username,
          password: MQTT_PRESET_CONFIG.password,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
        }),
      });
    } catch {
      // Static Netlify hosting uses direct Browser WSS client above
    }
  };

  // Send Command to ESP32-S3 via Direct Browser WSS + Backend Bridge
  const handleSendDeviceCommand = async (cmd: string, payload?: Record<string, unknown>) => {
    const cleanPrefix = (bridge.topicPrefix || 'axionis').replace(/^\/+|\/+$/g, '') || 'axionis';
    const targetDevId = bridge.deviceId || health.device || 'AXIONIS-Edge-0417';
    const cmdTopic = `${cleanPrefix}/${targetDevId}/cmd`;
    const msgStr = JSON.stringify({
      cmd,
      ...(payload || {}),
      ts: Math.floor(Date.now() / 1000),
    });

    let publishedViaWss = false;
    if (wssClientRef.current && wssClientRef.current.connected) {
      try {
        wssClientRef.current.publish(cmdTopic, msgStr, { qos: 1 });
        wssClientRef.current.publish(`${cleanPrefix}/${targetDevId}/command`, msgStr, { qos: 1 });
        publishedViaWss = true;
      } catch {}
    }

    try {
      const headers = await getAuthHeaders(currentUser);
      const res = await fetch('/api/bridge/cmd', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cmd,
          payload,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Perintah ${cmd} dikirim ke ${data.topic}`);
        return;
      }
    } catch {}

    if (publishedViaWss) {
      showToast(`Perintah ${cmd} dikirim via MQTT WSS ke ${cmdTopic}`);
    } else {
      showToast(`Broker WSS belum terhubung. Cek konfigurasi Broker URL di IoT Bridge.`);
    }
  };

  const handleManualSaveDetection = () => {
    const nowIso = new Date().toISOString();
    const faceThresh = settings.alertPreferences.faceThreshold;
    const dysThresh = settings.alertPreferences.dysThreshold;
    const isFaceHigh = telemetry.faceProb >= faceThresh;
    const isDysHigh = telemetry.dysProb >= dysThresh;
    const level: 'CRITICAL' | 'WARNING' | 'NORMAL' =
      isFaceHigh && isDysHigh
        ? 'CRITICAL'
        : isFaceHigh || isDysHigh
        ? 'WARNING'
        : 'NORMAL';
    const modality: 'Multimodal' | 'Visual' | 'Audio' =
      isFaceHigh && isDysHigh ? 'Multimodal' : isFaceHigh ? 'Visual' : 'Audio';
    const typeLabel =
      level === 'CRITICAL'
        ? 'Multimodal (Facial Droop + Dysarthria)'
        : isFaceHigh
        ? 'Visual (Indikasi Asimetri Wajah)'
        : isDysHigh
        ? 'Audio (Indikasi Disartria Suara)'
        : 'Pemeriksaan Normal (Wajah & Suara)';

    const manualEvt: StrokeEvent = {
      id: `EVT-${nowIso.slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`,
      device: bridge.deviceId || health.device || 'AXIONIS-Edge-0417',
      level,
      type: typeLabel,
      triggerModality: modality,
      timestamp: nowIso,
      faceProb: telemetry.faceProb,
      dysProb: telemetry.dysProb,
      rms: telemetry.rms,
      uptimeSec: health.uptimeSec || 14520,
      msg: `Data deteksi disimpan (${currentUser.name}): Wajah ${(telemetry.faceProb * 100).toFixed(1)}%, Suara ${(telemetry.dysProb * 100).toFixed(1)}%, RMS ${telemetry.rms.toFixed(4)}.`,
      acknowledged: level === 'NORMAL',
      acknowledgedBy: level === 'NORMAL' ? currentUser.name : null,
      acknowledgedAt: level === 'NORMAL' ? nowIso : null,
      clinicalNotes: null,
      snapshotMeta: {
        roiResolution: '240x240 RGB565',
        mouthTiltDeg: +(telemetry.faceProb * 9.5).toFixed(1),
        peakFreqHz: Math.round(360 + (1 - telemetry.dysProb) * 240),
        mfccSummary:
          telemetry.mfccBins && telemetry.mfccBins.length > 0
            ? telemetry.mfccBins
            : Array.from({ length: 16 }, () => 15),
        snapshotB64: telemetry.snapshotB64 || null,
      },
    };

    recordAndPersistDetection(manualEvt, {
      openModalIfAlert: level !== 'NORMAL',
      pushToBackend: true,
    });
    showToast(`Data deteksi (${level}) berhasil disimpan ke Event History.`);
  };

  const handleAcknowledgeAlert = async (evtId: string, customNotes?: string) => {
    const notesToUse = (customNotes ?? ackNotesInput).trim() || 'Telah diperiksa dan ditangani oleh keluarga.';
    const ackAt = new Date().toISOString();

    // Publish ACK_ALARM via Browser WSS directly to ESP32
    if (wssClientRef.current && wssClientRef.current.connected) {
      const cleanPrefix = (bridge.topicPrefix || 'axionis').replace(/^\/+|\/+$/g, '') || 'axionis';
      const targetDevId = bridge.deviceId || health.device || 'AXIONIS-Edge-0417';
      try {
        wssClientRef.current.publish(
          `${cleanPrefix}/${targetDevId}/cmd`,
          JSON.stringify({ cmd: 'ACK_ALARM', alertId: evtId, by: currentUser.name }),
          { qos: 1 }
        );
      } catch {}
    }

    // Optimistic local + LocalStorage + Firestore update (works on Netlify static & full-stack)
    setEvents((prev) => {
      const next = prev.map((e) => {
        if (e.id !== evtId) return e;
        const updatedItem: StrokeEvent = {
          ...e,
          acknowledged: true,
          acknowledgedBy: currentUser.name,
          acknowledgedAt: ackAt,
          clinicalNotes: notesToUse,
        };
        persistStrokeEventToFirestore(updatedItem).catch(() => {});
        return updatedItem;
      });
      saveEventsToLocal(next);
      return next;
    });
    setEmergencyModalEvent(null);
    setAckNotesInput('');

    try {
      const headers = await getAuthHeaders(currentUser);
      const res = await fetch(`/api/alerts/${evtId}/acknowledge`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          clinicalNotes: notesToUse,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as StrokeEvent;
        setEvents((prev) => {
          const next = prev.map((e) => (e.id === evtId ? updated : e));
          saveEventsToLocal(next);
          return next;
        });
        persistStrokeEventToFirestore(updated).catch(() => {});
      }
    } catch {}

    showToast(`Alert ${evtId} dikonfirmasi & disimpan ke Event History.`);
  };

  const handleInviteFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      const headers = await getAuthHeaders(currentUser);
      const res = await fetch('/api/family/invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: inviteName,
          email: inviteEmail,
          role: inviteRole,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gagal mengundang anggota.');
        return;
      }
      setFamily(data);
      setInviteName('');
      setInviteEmail('');
      showToast(`Undangan dikirim ke ${inviteEmail}.`);
    } catch {
      showToast('Gagal mengirim undangan.');
    }
  };

  const handleUpdateFamilyMember = async (
    memberId: string,
    updates: { role?: CareRole; viewing?: boolean; status?: 'Active' | 'Pending' }
  ) => {
    if (currentUser.role !== 'Primary Caregiver') {
      showToast('Hanya Primary Caregiver yang dapat mengubah akses.');
      return;
    }
    try {
      const headers = await getAuthHeaders(currentUser);
      const res = await fetch(`/api/family/${memberId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ...updates,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
        }),
      });
      if (res.ok) {
        setFamily(await res.json());
        showToast('Akses diperbarui.');
      }
    } catch {
      showToast('Gagal memperbarui akses.');
    }
  };

  const handleDeleteFamilyMember = async (memberId: string) => {
    if (currentUser.role !== 'Primary Caregiver') {
      showToast('Hanya Primary Caregiver yang dapat menghapus anggota.');
      return;
    }
    try {
      const headers = await getAuthHeaders(currentUser);
      const res = await fetch(`/api/family/${memberId}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setFamily(await res.json());
        showToast('Anggota dihapus.');
      }
    } catch {
      showToast('Gagal menghapus anggota.');
    }
  };

  const handleGoogleAccountSwitch = async () => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const synced = await syncFirebaseUserProfile(cred.user, {
        deviceId: bridge.deviceId,
      });
      handleSetAuthenticatedUser(synced.user, synced.users);
    } catch {
      showToast('Batal atau gagal masuk dengan Google.');
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) return;
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          deviceId: bridge.deviceId,
          password: regPassword,
          role: regRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gagal membuat akun.');
        return;
      }
      handleSetAuthenticatedUser(data.user, data.users);
      setRegName('');
      setRegEmail('');
      setRegPassword('');
      setAuthTab('profile');
    } catch {
      showToast('Gagal mendaftarkan akun.');
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, newPassword: resetNewPassword || 'axionis123' }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Email tidak ditemukan.');
        return;
      }
      setResetEmail('');
      setResetNewPassword('');
      setAuthTab('profile');
      showToast(data.message);
    } catch {
      showToast('Gagal mereset kata sandi.');
    }
  };

  const handleSaveSettings = async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    try {
      const headers = await getAuthHeaders(currentUser);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...nextSettings,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
        }),
      });
      if (res.ok) {
        setSettings(await res.json());
        showToast('Pengaturan disimpan & dikirim ke ESP32-S3.');
      }
    } catch {
      showToast('Gagal menyimpan pengaturan.');
    }
  };

  const handleDownloadCsvReport = () => {
    const headers = ['Waktu', 'ID', 'Device', 'Tipe_Warning', 'Kategori', 'Wajah_Persen', 'Suara_Persen', 'RMS', 'Status_Ack'];
    const rows = filteredEvents.map((e) => [
      `"${formatWibTime(e.timestamp)}"`,
      e.id,
      e.device,
      e.level,
      `"${e.type}"`,
      (e.faceProb * 100).toFixed(1),
      (e.dysProb * 100).toFixed(1),
      e.rms.toFixed(4),
      `"${e.acknowledgedBy || 'Belum dikonfirmasi'}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `AXIONIS_History_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const unacknowledgedAlerts = events.filter((e) => !e.acknowledged && e.level !== 'NORMAL');
  const unacknowledgedCount = unacknowledgedAlerts.length;

  const filteredEvents = events.filter((evt) => {
    if (historyLevelFilter !== 'ALL' && evt.level !== historyLevelFilter) return false;
    if (historySearchQuery.trim()) {
      const q = historySearchQuery.toLowerCase();
      return (
        evt.id.toLowerCase().includes(q) ||
        evt.msg.toLowerCase().includes(q) ||
        evt.type.toLowerCase().includes(q) ||
        evt.level.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Navigation items WITHOUT Alert Center tab (Alerts are strictly Pop-up Notifications)
  const navItems: {
    id: ModuleId;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'live_monitor', label: 'Live Monitor', shortLabel: 'Monitor', icon: Video },
    { id: 'device_health', label: 'Device Health', shortLabel: 'Device', icon: ShieldCheck },
    { id: 'event_history', label: 'Event History', shortLabel: 'History', icon: History },
    { id: 'family_access', label: 'Family Access', shortLabel: 'Family', icon: Users },
    { id: 'account_access', label: 'Account Access', shortLabel: 'Account', icon: UserCheck },
    { id: 'app_settings', label: 'App Settings', shortLabel: 'Settings', icon: Settings },
  ];

  // Soft, low-glare theme tokens based on selected preset
  const isLight = colorPreset === 'warm_alabaster' || !settings.displayOptions.darkMode;
  const isNordic = colorPreset === 'nordic_slate';

  const canvasBg = isLight ? 'bg-stone-100 text-stone-800' : isNordic ? 'bg-slate-950 text-slate-200' : 'bg-zinc-950 text-zinc-200';
  const surfaceBg = isLight ? 'bg-white border-stone-200/90' : isNordic ? 'bg-slate-900/90 border-slate-800/90' : 'bg-zinc-900/90 border-zinc-800/85';
  const subSurfaceBg = isLight ? 'bg-stone-50 border-stone-200/80' : isNordic ? 'bg-slate-950/70 border-slate-800/80' : 'bg-zinc-950/70 border-zinc-800/80';
  const accentText = isLight ? 'text-teal-700' : isNordic ? 'text-sky-300' : 'text-teal-300';
  const accentBtn = isLight
    ? 'bg-teal-700 hover:bg-teal-800 text-white'
    : isNordic
    ? 'bg-sky-700 hover:bg-sky-600 text-white'
    : 'bg-teal-700 hover:bg-teal-600 text-zinc-100';
  const activeNavBg = isLight
    ? 'bg-teal-50 text-teal-800 border border-teal-200 font-semibold'
    : isNordic
    ? 'bg-sky-950/50 text-sky-200 border border-sky-800/50'
    : 'bg-teal-950/45 text-teal-200 border border-teal-800/45';

  const isDeviceConnected = hasReceivedLivePacket && health.online;
  const pipelineMeta = getPipelineNotificationMeta(
    telemetry.state,
    telemetry,
    settings.devicePreferences.faceHoldSeconds
  );

  const copyText = (txt: string) => {
    navigator.clipboard?.writeText(txt);
    showToast('Disalin ke clipboard');
  };

  return (
    <div className={`min-h-screen w-full max-w-full overflow-x-hidden flex flex-col text-sm transition-colors duration-200 ${canvasBg}`}>
      {/* ==================== TOP BAR (3-ZONE CONTRACT) ==================== */}
      <header
        className={`sticky top-0 z-30 w-full max-w-full flex items-center justify-between gap-2 sm:gap-6 px-3 sm:px-6 h-14 border-b backdrop-blur-md ${surfaceBg}`}
      >
        {/* Zone 1: Brand Title */}
        <a
          href="#live_monitor"
          onClick={(e) => {
            e.preventDefault();
            setActiveModule('live_monitor');
          }}
          className={`text-sm sm:text-base font-bold tracking-tight truncate min-w-0 font-display ${
            isLight ? 'text-stone-900' : 'text-zinc-100'
          }`}
        >
          AXIONIS Care Watch
        </a>

        {/* Zone 2: Desktop Single-Line Navigation (No Alerts Tab) */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-medium shrink-0">
          {[
            { id: 'live_monitor' as ModuleId, label: 'Monitor' },
            { id: 'device_health' as ModuleId, label: 'Device' },
            { id: 'event_history' as ModuleId, label: 'History' },
            { id: 'family_access' as ModuleId, label: 'Family' },
            { id: 'app_settings' as ModuleId, label: 'Settings' },
          ].map((nav) => (
            <button
              key={nav.id}
              onClick={() => setActiveModule(nav.id)}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeModule === nav.id
                  ? `border-teal-600 ${accentText} font-semibold`
                  : isLight
                  ? 'border-transparent text-stone-500 hover:text-stone-900'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Pop-Up Alert Trigger (Only if unacknowledged alert exists) + IoT Bridge Button */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {unacknowledgedCount > 0 && (
            <button
              onClick={() => setEmergencyModalEvent(unacknowledgedAlerts[0])}
              className="min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-semibold rounded-lg border bg-rose-950/60 border-rose-700/60 text-rose-200 hover:bg-rose-900/70 flex items-center gap-1 animate-pulse shrink-0"
              title="Buka Pop-up Notifikasi Peringatan"
            >
              <Bell className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{unacknowledgedCount}</span>
              <span className="hidden sm:inline">Alert</span>
            </button>
          )}

          <button
            onClick={() => setShowBridgeModal(true)}
            className={`min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              bridge.connected
                ? isLight
                  ? 'bg-teal-50 border-teal-200 text-teal-800 hover:bg-teal-100'
                  : 'bg-teal-950/40 border-teal-800/50 text-teal-300 hover:bg-teal-950/70'
                : isLight
                ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{bridge.connected ? `Bridge: ${bridge.deviceId}` : 'IoT Bridge'}</span>
            <span className="sm:hidden">{bridge.connected ? 'Online' : 'Bridge'}</span>
          </button>
        </div>
      </header>

      {/* ==================== DEVICE PIPELINE NOTIFICATION POP-UP (ONLY WHEN CONNECTED TO DEVICE) ==================== */}
      {isDeviceConnected && !pipelinePopupDismissed && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-6 z-40 sm:max-w-sm bg-zinc-900/95 border border-teal-800/60 text-zinc-100 px-3.5 py-2.5 rounded-xl shadow-xl backdrop-blur-md flex items-start justify-between gap-2.5">
          <div className="flex items-start gap-2 min-w-0">
            <Activity className="w-4 h-4 text-teal-400 shrink-0 mt-0.5 animate-pulse" />
            <div className="space-y-0.5 text-xs min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800/60 shrink-0">
                  Tahap {pipelineMeta.stepIndex}/5
                </span>
                <span className="font-bold font-display text-zinc-100 truncate">{pipelineMeta.title}</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono break-words">{pipelineMeta.detail}</p>
            </div>
          </div>
          <button
            onClick={() => setPipelinePopupDismissed(true)}
            className="text-zinc-500 hover:text-zinc-300 p-1 shrink-0"
            title="Sembunyikan sementara"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ==================== GENERAL STATUS TOAST ==================== */}
      {statusToast && (
        <div className="fixed bottom-20 lg:bottom-5 left-3 right-3 sm:left-auto sm:right-5 z-50 sm:max-w-sm bg-zinc-900 border border-zinc-700 text-zinc-100 px-3.5 py-2.5 rounded-xl shadow-lg flex items-center gap-2.5 text-xs">
          <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
          <span className="break-words">{statusToast}</span>
        </div>
      )}

      {/* ==================== MOBILE SLIDE-UP DRAWER ==================== */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-zinc-950/75 backdrop-blur-sm flex flex-col justify-end">
          <div className={`w-full max-w-full rounded-t-3xl border-t p-4 sm:p-5 space-y-4 max-h-[85vh] overflow-y-auto ${surfaceBg}`}>
            <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto" />
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold font-display truncate">{currentUser.name}</div>
                <div className={`text-xs truncate ${accentText}`}>
                  {currentUser.role} · {currentUser.email}
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] min-w-[40px] shrink-0 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`min-h-[46px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium border min-w-0 ${
                      isActive ? activeNavBg : `${subSurfaceBg} text-zinc-400`
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                handleSetAuthenticatedUser(null);
              }}
              className="w-full min-h-[44px] rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 font-medium text-xs flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout / Ganti Pengguna</span>
            </button>
          </div>
        </div>
      )}

      {/* ==================== AUTO-CONNECTED IOT BRIDGE MODAL (CONNECT / SYNC BUTTON ONLY) ==================== */}
      {showBridgeModal && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl max-h-[88vh] overflow-y-auto text-zinc-100">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Radio className="w-4 h-4 text-teal-400 shrink-0 animate-pulse" />
                <h2 className="text-sm sm:text-base font-bold font-display truncate">
                  Auto-Bridge IoT (ESP32-S3)
                </h2>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded shrink-0 ${
                  wssBrokerConnected
                    ? 'bg-teal-950/80 text-teal-300 border border-teal-800/60'
                    : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                }`}
              >
                {wssBrokerConnected ? 'AUTO-CONNECTED' : 'CONNECTING...'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 min-w-0">
                <span className="text-[10px] text-zinc-500 block font-sans">Perangkat Terhubung</span>
                <span className="font-bold text-teal-300 truncate block mt-0.5">{bridge.deviceId}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 min-w-0">
                <span className="text-[10px] text-zinc-500 block font-sans">Status Paket ESP32</span>
                <span
                  className={`font-bold truncate block mt-0.5 ${
                    hasReceivedLivePacket ? 'text-teal-300' : 'text-amber-300'
                  }`}
                >
                  {hasReceivedLivePacket
                    ? `LIVE (${cameraFrameCount} frame)`
                    : wssBrokerConnected
                    ? 'WSS Siap · Menunggu ESP32'
                    : 'Auto-Bridge Aktif'}
                </span>
              </div>
            </div>

            {wssError && (
              <div className="bg-rose-950/60 border border-rose-800/60 rounded-xl p-2.5 text-xs text-rose-200 font-mono">
                Error Broker: {wssError}
              </div>
            )}

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2 overflow-hidden text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-zinc-300">Preset Broker (Tertanam di Kode):</span>
                <code className="text-[10px] font-mono text-teal-300 truncate">{activeWssUrl}</code>
              </div>
              <div className="space-y-1.5 font-mono text-[10px] sm:text-[11px] text-zinc-400 pt-1 border-t border-zinc-800/80">
                {[
                  { label: 'Status', topic: `${bridge.topicPrefix}/${bridge.deviceId}/status` },
                  { label: 'Camera', topic: `${bridge.topicPrefix}/${bridge.deviceId}/camera` },
                  { label: 'Telemetry', topic: `${bridge.topicPrefix}/${bridge.deviceId}/telemetry` },
                  { label: 'Alert', topic: `${bridge.topicPrefix}/${bridge.deviceId}/alert` },
                  { label: 'Command', topic: `${bridge.topicPrefix}/${bridge.deviceId}/cmd` },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 min-w-0">
                    <span className="truncate min-w-0">
                      {item.label}: <code className="text-teal-300">{item.topic}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(item.topic)}
                      className="text-zinc-500 hover:text-zinc-300 shrink-0 p-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowBridgeModal(false)}
                className="min-h-[40px] px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handleAutoSyncBridge}
                className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${accentBtn}`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Connect / Sync</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ALERT POP-UP NOTIFICATION MODAL (ONLY POP-UP WHEN CONDITION MET) ==================== */}
      {emergencyModalEvent && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-md w-full bg-zinc-900 border border-rose-800/60 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-2xl max-h-[88vh] overflow-y-auto text-zinc-100">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[10px] sm:text-[11px] font-mono text-rose-300 break-words">
                    {emergencyModalEvent.level} WARNING · {formatWibTime(emergencyModalEvent.timestamp)}
                  </div>
                  <h2 className="text-sm sm:text-base font-bold font-display break-words">{emergencyModalEvent.type}</h2>
                </div>
              </div>
              <button
                onClick={() => setSirenMutedSession((prev) => !prev)}
                className="min-h-[38px] min-w-[38px] shrink-0 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-300"
                title="Mute / Unmute Sirine"
              >
                {sirenMutedSession ? <VolumeX className="w-4 h-4 text-rose-300" /> : <Volume2 className="w-4 h-4 text-teal-300" />}
              </button>
            </div>

            <p className="text-xs text-zinc-300 bg-zinc-950 p-3 rounded-lg border border-zinc-800 break-words">
              {emergencyModalEvent.msg}
            </p>

            <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-center">
              <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 min-w-0">
                <div className="text-[10px] text-zinc-400 truncate">Wajah (%)</div>
                <div className="text-sm sm:text-base font-bold text-rose-300">{(emergencyModalEvent.faceProb * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 min-w-0">
                <div className="text-[10px] text-zinc-400 truncate">Suara (%)</div>
                <div className="text-sm sm:text-base font-bold text-amber-300">{(emergencyModalEvent.dysProb * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 min-w-0">
                <div className="text-[10px] text-zinc-400 truncate">RMS</div>
                <div className="text-sm sm:text-base font-bold text-teal-300">{emergencyModalEvent.rms.toFixed(4)}</div>
              </div>
            </div>

            {!emergencyModalEvent.acknowledged ? (
              <>
                <input
                  type="text"
                  value={ackNotesInput}
                  onChange={(e) => setAckNotesInput(e.target.value)}
                  placeholder="Catatan kondisi pasien..."
                  className="w-full min-h-[40px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100"
                />

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEmergencyModalEvent(null)}
                    className="min-h-[40px] px-3.5 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-300"
                  >
                    Tutup
                  </button>
                  <button
                    onClick={() => handleAcknowledgeAlert(emergencyModalEvent.id)}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-xs font-semibold"
                  >
                    Konfirmasi & Tangani
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800 text-xs">
                <span className="text-teal-300 truncate">
                  Ditangani oleh {emergencyModalEvent.acknowledgedBy}
                </span>
                <button
                  onClick={() => setEmergencyModalEvent(null)}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 shrink-0"
                >
                  Tutup
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== MAIN LAYOUT ==================== */}
      <div className="flex flex-1 w-full max-w-full overflow-hidden pb-16 lg:pb-0">
        {/* DESKTOP SIDEBAR (No Alert Center Tab) */}
        <aside className={`hidden lg:flex w-60 shrink-0 border-r p-4 flex-col justify-between overflow-y-auto ${surfaceBg}`}>
          <div className="space-y-4">
            <div className="px-2 py-1 space-y-0.5">
              <div className={`text-xs font-mono font-semibold truncate ${accentText}`}>{health.device}</div>
              <div className="text-[11px] font-mono text-zinc-400">
                {isDeviceConnected ? 'Device Connected' : 'Waiting Device'} · {health.rssi} dBm
              </div>
            </div>

            <div className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveModule(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? activeNavBg
                        : isLight
                        ? 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                        : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`p-3 rounded-xl border text-xs space-y-2 ${subSurfaceBg}`}>
            <div>
              <div className="font-semibold truncate">{currentUser.name}</div>
              <div className={`text-[11px] truncate ${accentText}`}>{currentUser.role}</div>
            </div>
            <button
              onClick={() => handleSetAuthenticatedUser(null)}
              className="w-full py-1.5 px-2.5 rounded-lg bg-zinc-800/80 hover:bg-rose-950/50 text-zinc-300 hover:text-rose-300 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout / Ganti Akun</span>
            </button>
          </div>
        </aside>

        {/* ==================== CONTENT AREA (Strictly bounded for mobile portrait) ==================== */}
        <main className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5">
          {isLoading ? (
            <div className={`h-64 rounded-xl border animate-pulse ${surfaceBg}`} />
          ) : (
            <>
              {/* ==================== 1. LIVE MONITOR ==================== */}
              {activeModule === 'live_monitor' && (
                <div className="w-full max-w-full space-y-3.5 sm:space-y-5">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 sm:gap-5 items-stretch">
                    {/* Live Camera */}
                    <section className={`lg:col-span-2 min-w-0 w-full rounded-xl border p-3 sm:p-4 flex flex-col justify-between space-y-3 ${surfaceBg}`}>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Camera className={`w-4 h-4 shrink-0 ${accentText}`} />
                          <h2 className="text-xs sm:text-sm font-bold font-display truncate">Live Camera (OV5640)</h2>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
                          Wajah:{' '}
                          <strong
                            className={
                              telemetry.faceProb >= settings.alertPreferences.faceThreshold
                                ? 'text-rose-400'
                                : accentText
                            }
                          >
                            {(telemetry.faceProb * 100).toFixed(1)}%
                          </strong>
                        </span>
                      </div>

                      <LiveCameraViewport
                        telemetry={telemetry}
                        deviceOnline={isDeviceConnected}
                        deviceIp={health.ip}
                        hasReceivedLivePacket={hasReceivedLivePacket}
                        faceThreshold={settings.alertPreferences.faceThreshold}
                        holdDuration={settings.devicePreferences.faceHoldSeconds}
                        privacyBlur={settings.displayOptions.privacyBlurCamera}
                      />

                      <div className="grid grid-cols-2 gap-2 sm:gap-3 font-mono tabular-nums text-xs">
                        <div className={`p-2.5 rounded-lg border min-w-0 ${subSurfaceBg}`}>
                          <span className="text-zinc-500 block text-[10px] truncate">Persentase Wajah</span>
                          <span className="font-semibold">{(telemetry.faceProb * 100).toFixed(1)}%</span>
                        </div>
                        <div className={`p-2.5 rounded-lg border min-w-0 ${subSurfaceBg}`}>
                          <span className="text-zinc-500 block text-[10px] truncate">Status Perangkat</span>
                          <span
                            className={`font-semibold truncate block ${
                              hasReceivedLivePacket ? accentText : 'text-amber-300'
                            }`}
                          >
                            {hasReceivedLivePacket
                              ? 'ESP32 Live (Aktif)'
                              : wssBrokerConnected
                              ? 'WSS Siap (Menunggu ESP32)'
                              : 'Bridge Siap'}
                          </span>
                        </div>
                      </div>
                    </section>

                    {/* Audio Readout */}
                    <section className={`min-w-0 w-full rounded-xl border p-3 sm:p-4 flex flex-col justify-between space-y-3.5 ${surfaceBg}`}>
                      <div className="space-y-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Mic className={`w-4 h-4 shrink-0 ${accentText}`} />
                            <h2 className="text-xs sm:text-sm font-bold font-display truncate">Audio Readout (INMP441)</h2>
                          </div>
                          <span className="text-[11px] font-mono text-zinc-400 shrink-0">16 kHz</span>
                        </div>

                        <AudioWaveformBar
                          telemetry={telemetry}
                          deviceOnline={isDeviceConnected}
                          hasReceivedLivePacket={hasReceivedLivePacket}
                          hasLiveAudioPacket={hasLiveAudioPacket}
                          rmsThreshold={settings.devicePreferences.rmsThreshold}
                          dysThreshold={settings.alertPreferences.dysThreshold}
                        />

                        <div className={`p-2.5 sm:p-3 rounded-lg border space-y-1.5 ${subSurfaceBg}`}>
                          <div className="flex justify-between text-xs font-mono tabular-nums">
                            <span className="text-zinc-400">RMS Level (INMP441)</span>
                            <span className={`font-semibold ${isDeviceConnected ? accentText : 'text-zinc-500'}`}>
                              {isDeviceConnected ? telemetry.rms.toFixed(4) : '0.0000'}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-150 ${
                                isDeviceConnected && telemetry.rms >= settings.devicePreferences.rmsThreshold
                                  ? 'bg-teal-500/80'
                                  : 'bg-zinc-600'
                              }`}
                              style={{
                                width: `${isDeviceConnected ? Math.min(100, telemetry.rms * 2500) : 0}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-zinc-500">
                            <span>Gate: {settings.devicePreferences.rmsThreshold}</span>
                            <span className={hasLiveAudioPacket ? 'text-teal-400' : 'text-zinc-500'}>
                              {hasLiveAudioPacket
                                ? 'Stream Audio Aktif'
                                : isDeviceConnected
                                ? 'Menunggu Paket Audio'
                                : 'Offline'}
                            </span>
                          </div>
                        </div>

                        <div className={`p-2.5 sm:p-3 rounded-lg border space-y-1.5 ${subSurfaceBg}`}>
                          <div className="flex justify-between text-xs font-mono tabular-nums">
                            <span className="text-zinc-400">Suara (Disartria)</span>
                            <span className="font-semibold text-amber-300">
                              {isDeviceConnected ? `${(telemetry.dysProb * 100).toFixed(1)}%` : '0.0%'}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500/75 transition-all duration-150"
                              style={{
                                width: `${isDeviceConnected ? Math.min(100, telemetry.dysProb * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <div className="text-[10px] sm:text-[11px] font-mono text-zinc-500">
                            Threshold: {(settings.alertPreferences.dysThreshold * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-xs">
                        <span className="text-zinc-400 truncate">Perintah & Log:</span>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={handleManualSaveDetection}
                            className={`min-h-[34px] px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${subSurfaceBg} hover:border-teal-600/60`}
                            title="Simpan pembacaan Wajah, Suara, & RMS saat ini ke Event History"
                          >
                            Simpan History
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendDeviceCommand('START_AUDIO')}
                            className={`min-h-[34px] px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${subSurfaceBg} hover:border-teal-600/60`}
                          >
                            Tes Mic 2s
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendDeviceCommand('START_SCAN')}
                            className={`min-h-[34px] px-3 py-1.5 rounded-lg font-medium text-[11px] ${accentBtn}`}
                          >
                            Request Scan
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {/* ==================== 2. DEVICE HEALTH & IOT BRIDGE ==================== */}
              {activeModule === 'device_health' && (
                <div className="w-full max-w-full space-y-3.5 sm:space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5">
                    <div className={`rounded-xl border p-3.5 sm:p-4 space-y-1.5 min-w-0 ${surfaceBg}`}>
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>Online Status (LWT)</span>
                        <ShieldCheck className={`w-4 h-4 shrink-0 ${accentText}`} />
                      </div>
                      <div className={`text-lg sm:text-xl font-bold font-mono ${isDeviceConnected ? accentText : 'text-amber-400/90'}`}>
                        {isDeviceConnected ? 'ONLINE' : 'WAITING TELEMETRY'}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400 truncate">
                        Topik: {bridge.topicPrefix}/{health.device}/status
                      </div>
                    </div>

                    <div className={`rounded-xl border p-3.5 sm:p-4 space-y-1.5 font-mono tabular-nums min-w-0 ${surfaceBg}`}>
                      <div className="flex items-center justify-between text-xs text-zinc-400 font-sans">
                        <span>Connection & Memory</span>
                        <Wifi className={`w-4 h-4 shrink-0 ${accentText}`} />
                      </div>
                      <div className="text-lg sm:text-xl font-bold">{health.rssi} dBm</div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        IP: {health.ip} · PSRAM: {(health.freePsram / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    </div>

                    <div className={`rounded-xl border p-3.5 sm:p-4 space-y-1.5 font-mono tabular-nums min-w-0 ${surfaceBg}`}>
                      <div className="flex items-center justify-between text-xs text-zinc-400 font-sans">
                        <span>Last Seen</span>
                        <Clock className="w-4 h-4 shrink-0 text-zinc-400" />
                      </div>
                      <div className="text-lg sm:text-xl font-bold">{formatRelativeSeconds(health.lastSeen)}</div>
                      <div className="text-[11px] text-zinc-400">
                        Uptime: {(health.uptimeSec / 3600).toFixed(1)} jam
                      </div>
                    </div>
                  </div>

                  {/* Auto-Connected IoT Bridge Status Card (Connect / Sync Button Only) */}
                  <section className={`rounded-xl border p-3.5 sm:p-5 space-y-3.5 min-w-0 ${surfaceBg}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link2 className={`w-4 h-4 shrink-0 ${accentText}`} />
                        <h3 className="text-xs sm:text-sm font-bold font-display truncate">
                          Jembatan Perangkat IoT Otomatis (Auto-Connected)
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleAutoSyncBridge}
                          className={`min-h-[36px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold ${accentBtn}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Connect / Sync</span>
                        </button>
                        <button
                          onClick={() => handleSendDeviceCommand('PING_STATUS')}
                          className={`min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-medium ${subSurfaceBg}`}
                        >
                          Ping ESP32-S3
                        </button>
                        <button
                          onClick={() => handleSendDeviceCommand('REBOOT')}
                          className={`min-h-[36px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-medium ${subSurfaceBg}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Reboot</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 text-xs font-mono">
                      <div className={`p-3 rounded-xl border min-w-0 ${subSurfaceBg}`}>
                        <span className="text-[10px] text-zinc-500 block font-sans">Device ID Aktif</span>
                        <span className={`font-semibold truncate block mt-0.5 ${accentText}`}>{bridge.deviceId}</span>
                      </div>
                      <div className={`p-3 rounded-xl border min-w-0 ${subSurfaceBg}`}>
                        <span className="text-[10px] text-zinc-500 block font-sans">Kanal MQTT Auto-Sub</span>
                        <span className="font-semibold truncate block mt-0.5">{bridge.topicPrefix}/{bridge.deviceId}/+</span>
                      </div>
                      <div className={`p-3 rounded-xl border min-w-0 ${subSurfaceBg}`}>
                        <span className="text-[10px] text-zinc-500 block font-sans">Status Jembatan</span>
                        <span className={`font-semibold truncate block mt-0.5 ${hasReceivedLivePacket ? accentText : 'text-amber-300'}`}>
                          {hasReceivedLivePacket
                            ? `ESP32 Live (${cameraFrameCount} frame)`
                            : wssBrokerConnected
                            ? 'Terhubung Otomatis (EMQX)'
                            : 'Menghubungkan...'}
                        </span>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* ==================== 3. EVENT HISTORY ==================== */}
              {activeModule === 'event_history' && (
                <div className="w-full max-w-full space-y-3.5 sm:space-y-5">
                  {/* Detection History Graph Card */}
                  <section className={`rounded-xl border p-3.5 sm:p-5 space-y-3 min-w-0 overflow-hidden ${surfaceBg}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Activity className={`w-4 h-4 shrink-0 ${accentText}`} />
                        <h2 className="text-xs sm:text-sm font-bold font-display truncate">
                          Grafik Riwayat Deteksi (Wajah %, Suara %, & RMS)
                        </h2>
                      </div>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {filteredEvents.length} data deteksi
                      </span>
                    </div>

                    <DetectionHistoryChart
                      events={filteredEvents}
                      faceThreshold={settings.alertPreferences.faceThreshold}
                      dysThreshold={settings.alertPreferences.dysThreshold}
                      isLight={isLight}
                    />
                  </section>

                  {/* Filter & Search Bar */}
                  <div className={`rounded-xl border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 min-w-0 ${surfaceBg}`}>
                    <div className="grid grid-cols-4 sm:flex items-center gap-1.5">
                      {(['ALL', 'CRITICAL', 'WARNING', 'NORMAL'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          onClick={() => setHistoryLevelFilter(lvl)}
                          className={`min-h-[34px] px-2 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-medium text-center truncate ${
                            historyLevelFilter === lvl ? accentBtn : `${subSurfaceBg} text-zinc-400`
                          }`}
                        >
                          {lvl === 'ALL' ? 'Semua' : lvl}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:flex-initial min-w-0">
                        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={historySearchQuery}
                          onChange={(e) => setHistorySearchQuery(e.target.value)}
                          placeholder="Cari tipe warning / waktu..."
                          className={`w-full min-h-[36px] pl-8 pr-3 py-1.5 rounded-lg border text-xs ${subSurfaceBg}`}
                        />
                      </div>
                      <button
                        onClick={handleDownloadCsvReport}
                        className={`min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs shrink-0 ${accentBtn}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>CSV</span>
                      </button>
                    </div>
                  </div>

                  {/* MOBILE PORTRAIT CARDS (Fits 100% of phone screen without clipping) */}
                  <div className="md:hidden space-y-2.5">
                    {filteredEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className={`rounded-xl border p-3.5 space-y-2.5 min-w-0 ${surfaceBg}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${
                              evt.level === 'CRITICAL'
                                ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                                : evt.level === 'WARNING'
                                ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                                : 'bg-teal-950/60 text-teal-300 border-teal-800/60'
                            }`}
                          >
                            {evt.level}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-400 truncate">
                            {formatWibTime(evt.timestamp)}
                          </span>
                        </div>

                        <div className="text-xs font-bold break-words">{evt.type}</div>

                        <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-center">
                          <div className={`p-2 rounded-lg border min-w-0 ${subSurfaceBg}`}>
                            <div className="text-[10px] text-zinc-400 truncate">Wajah</div>
                            <div className="text-xs font-bold text-rose-300">{(evt.faceProb * 100).toFixed(1)}%</div>
                          </div>
                          <div className={`p-2 rounded-lg border min-w-0 ${subSurfaceBg}`}>
                            <div className="text-[10px] text-zinc-400 truncate">Suara</div>
                            <div className="text-xs font-bold text-amber-300">{(evt.dysProb * 100).toFixed(1)}%</div>
                          </div>
                          <div className={`p-2 rounded-lg border min-w-0 ${subSurfaceBg}`}>
                            <div className="text-[10px] text-zinc-400 truncate">RMS</div>
                            <div className={`text-xs font-bold ${accentText}`}>{evt.rms.toFixed(4)}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] text-zinc-400 truncate">
                            {evt.acknowledged ? `Ditangani: ${evt.acknowledgedBy}` : 'Belum dikonfirmasi'}
                          </span>
                          <button
                            onClick={() => setEmergencyModalEvent(evt)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border shrink-0 ${
                              evt.acknowledged
                                ? `${subSurfaceBg} text-zinc-300`
                                : 'bg-rose-950/50 border-rose-800/60 text-rose-300'
                            }`}
                          >
                            {evt.acknowledged ? 'Detail' : 'Tangani'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* DESKTOP & TABLET TABLE */}
                  <div className={`hidden md:block rounded-xl border overflow-hidden ${surfaceBg}`}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className={`border-b font-mono text-[11px] text-zinc-400 ${subSurfaceBg}`}>
                            <th className="py-3 px-4">Waktu Deteksi</th>
                            <th className="py-3 px-4">Tipe Warning</th>
                            <th className="py-3 px-4">Wajah (%)</th>
                            <th className="py-3 px-4">Suara (%)</th>
                            <th className="py-3 px-4">RMS</th>
                            <th className="py-3 px-4 text-right">Status / Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60 font-mono tabular-nums">
                          {filteredEvents.map((evt) => (
                            <tr key={evt.id} className="hover:bg-zinc-800/25 transition-colors">
                              <td className="py-3.5 px-4 whitespace-nowrap text-zinc-300">
                                {formatWibTime(evt.timestamp)}
                              </td>
                              <td className="py-3.5 px-4 font-sans">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${
                                      evt.level === 'CRITICAL'
                                        ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                                        : evt.level === 'WARNING'
                                        ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                                        : 'bg-teal-950/60 text-teal-300 border-teal-800/60'
                                    }`}
                                  >
                                    {evt.level}
                                  </span>
                                  <span className="font-semibold truncate max-w-[220px]">{evt.type}</span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4 font-bold text-rose-300">
                                {(evt.faceProb * 100).toFixed(1)}%
                              </td>
                              <td className="py-3.5 px-4 font-bold text-amber-300">
                                {(evt.dysProb * 100).toFixed(1)}%
                              </td>
                              <td className={`py-3.5 px-4 font-bold ${accentText}`}>
                                {evt.rms.toFixed(4)}
                              </td>
                              <td className="py-3.5 px-4 text-right font-sans whitespace-nowrap">
                                <button
                                  onClick={() => setEmergencyModalEvent(evt)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                                    evt.acknowledged
                                      ? `${subSurfaceBg} text-zinc-400`
                                      : 'bg-rose-950/50 border-rose-800/60 text-rose-300 hover:bg-rose-900/60'
                                  }`}
                                >
                                  {evt.acknowledged ? 'Detail' : 'Tangani Pop-up'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 4. FAMILY ACCESS & REAL-TIME ACTIVITY ==================== */}
              {activeModule === 'family_access' && (
                <div className="w-full max-w-full space-y-3.5 sm:space-y-5">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 sm:gap-5">
                    <form onSubmit={handleInviteFamily} className={`rounded-xl border p-3.5 sm:p-4 space-y-3 min-w-0 ${surfaceBg}`}>
                      <h2 className="text-xs sm:text-sm font-bold font-display flex items-center gap-2">
                        <Send className={`w-4 h-4 shrink-0 ${accentText}`} />
                        <span>Invite Family</span>
                      </h2>
                      <input
                        type="text"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="Nama Anggota"
                        className={`w-full min-h-[40px] border rounded-lg px-3 py-2 text-xs ${subSurfaceBg}`}
                      />
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="Email Keluarga / Dokter"
                        className={`w-full min-h-[40px] border rounded-lg px-3 py-2 text-xs ${subSurfaceBg}`}
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as CareRole)}
                        className={`w-full min-h-[40px] border rounded-lg px-3 py-2 text-xs ${subSurfaceBg}`}
                      >
                        <option value="Family Viewer">Family Viewer</option>
                        <option value="Primary Caregiver">Primary Caregiver</option>
                      </select>
                      <button
                        type="submit"
                        className={`w-full min-h-[40px] font-semibold text-xs py-2 rounded-lg ${accentBtn}`}
                      >
                        Kirim Undangan
                      </button>
                    </form>

                    <div className={`lg:col-span-2 rounded-xl border p-3.5 sm:p-4 space-y-3 min-w-0 ${surfaceBg}`}>
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-xs sm:text-sm font-bold font-display truncate">Viewer Permissions & Shared View</h2>
                        <span className={`text-xs font-mono shrink-0 ${accentText}`}>{activeViewersCount} Online</span>
                      </div>
                      <div className="space-y-2">
                        {family.map((m) => (
                          <div
                            key={m.id}
                            className={`border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 min-w-0 ${subSurfaceBg}`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate">{m.name}</div>
                              <div className="text-[11px] text-zinc-400 truncate">{m.email}</div>
                            </div>
                            <div className="flex items-center justify-between sm:justify-end gap-2 text-xs">
                              <select
                                value={m.role}
                                onChange={(e) => handleUpdateFamilyMember(m.id, { role: e.target.value as CareRole })}
                                className={`min-h-[34px] border rounded-lg px-2 py-1 text-[11px] sm:text-xs flex-1 sm:flex-initial min-w-0 ${surfaceBg} ${accentText}`}
                              >
                                <option value="Primary Caregiver">Primary Caregiver</option>
                                <option value="Family Viewer">Family Viewer</option>
                              </select>
                              <button
                                onClick={() => handleUpdateFamilyMember(m.id, { viewing: !m.viewing })}
                                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1 shrink-0 ${
                                  m.viewing ? activeNavBg : 'bg-zinc-800/60 text-zinc-400'
                                }`}
                              >
                                {m.viewing ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                <span>{m.viewing ? 'Viewing' : 'Idle'}</span>
                              </button>
                              <button
                                onClick={() => handleDeleteFamilyMember(m.id)}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center text-zinc-500 hover:text-rose-400 shrink-0"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Minimalist Real-Time Activity Log */}
                  <div className={`rounded-xl border p-3.5 sm:p-4 space-y-3 min-w-0 ${surfaceBg}`}>
                    <h3 className="text-xs sm:text-sm font-bold font-display">Log Aktivitas Pengguna Real-Time</h3>
                    <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800/70 text-xs">
                      {activityLogs.slice(0, 15).map((log) => (
                        <div key={log.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 min-w-0">
                          <div className="break-words min-w-0">
                            <span className="font-semibold">{log.userName}</span>{' '}
                            <span className="text-zinc-400">— {log.description}</span>
                          </div>
                          <span className="font-mono text-[10px] sm:text-[11px] text-zinc-500 shrink-0">
                            {formatWibTime(log.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 5. ACCOUNT ACCESS ==================== */}
              {activeModule === 'account_access' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 sm:gap-5">
                  <div className={`lg:col-span-2 rounded-xl border p-3.5 sm:p-5 space-y-4 min-w-0 ${surfaceBg}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                      <div className="flex items-center gap-2">
                        <Lock className={`w-4 h-4 ${accentText}`} />
                        <h2 className="text-xs sm:text-sm font-bold font-display">Account Access</h2>
                      </div>
                      <div className="flex gap-1.5 text-xs">
                        {(['profile', 'register', 'reset'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setAuthTab(m)}
                            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] sm:text-xs ${
                              authTab === m ? accentBtn : `${subSurfaceBg} text-zinc-400`
                            }`}
                          >
                            {m === 'profile' ? 'Profil' : m === 'register' ? 'Tambah' : 'Reset'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {authTab === 'profile' && (
                      <div className="space-y-4 text-xs">
                        <div className={`p-3.5 rounded-xl border space-y-1.5 break-words ${subSurfaceBg}`}>
                          <p className="text-sm font-bold">{currentUser.name}</p>
                          <p className="text-zinc-400 font-mono break-all">{currentUser.email}</p>
                          <p className="text-zinc-400 font-mono">{currentUser.phoneWa}</p>
                          <p className={`font-semibold ${accentText}`}>{currentUser.role}</p>
                        </div>
                        <button
                          onClick={() => handleSetAuthenticatedUser(null)}
                          className="min-h-[40px] flex items-center gap-2 bg-rose-950/40 hover:bg-rose-950/60 text-rose-300 border border-rose-800/40 px-4 py-2 rounded-xl font-medium"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Logout ke Halaman Login</span>
                        </button>
                      </div>
                    )}

                    {authTab === 'register' && (
                      <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs max-w-sm">
                        <input
                          placeholder="Nama Lengkap"
                          required
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          className={`w-full min-h-[40px] border rounded-lg px-3 py-2 ${subSurfaceBg}`}
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className={`w-full min-h-[40px] border rounded-lg px-3 py-2 ${subSurfaceBg}`}
                        />
                        <select
                          value={regRole}
                          onChange={(e) => setRegRole(e.target.value as CareRole)}
                          className={`w-full min-h-[40px] border rounded-lg px-3 py-2 ${subSurfaceBg}`}
                        >
                          <option value="Family Viewer">Family Viewer</option>
                          <option value="Primary Caregiver">Primary Caregiver</option>
                        </select>
                        <input
                          type="password"
                          placeholder="Kata Sandi"
                          required
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          className={`w-full min-h-[40px] border rounded-lg px-3 py-2 ${subSurfaceBg}`}
                        />
                        <button type="submit" className={`min-h-[40px] font-semibold px-4 py-2 rounded-lg ${accentBtn}`}>
                          Buat Akun
                        </button>
                      </form>
                    )}

                    {authTab === 'reset' && (
                      <form onSubmit={handleResetPasswordSubmit} className="space-y-3 text-xs max-w-sm">
                        <input
                          type="email"
                          required
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="Email terdaftar"
                          className={`w-full min-h-[40px] border rounded-lg px-3 py-2 ${subSurfaceBg}`}
                        />
                        <input
                          type="password"
                          required
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          placeholder="Kata sandi baru"
                          className={`w-full min-h-[40px] border rounded-lg px-3 py-2 ${subSurfaceBg}`}
                        />
                        <button type="submit" className={`min-h-[40px] font-semibold px-4 py-2 rounded-lg ${accentBtn}`}>
                          Reset Kata Sandi
                        </button>
                      </form>
                    )}
                  </div>

                  <div className={`rounded-xl border p-3.5 sm:p-4 space-y-3 min-w-0 ${surfaceBg}`}>
                    <h3 className="text-xs sm:text-sm font-bold font-display">Firebase Google Auth</h3>
                    <p className="text-xs text-zinc-400">
                      Masuk atau tautkan sesi Anda menggunakan akun Google melalui Firebase Authentication.
                    </p>
                    <button
                      type="button"
                      onClick={handleGoogleAccountSwitch}
                      className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                    >
                      <span>Login / Ganti Akun Google</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ==================== 6. APP SETTINGS ==================== */}
              {activeModule === 'app_settings' && (
                <div className="w-full max-w-full space-y-4 sm:space-y-5">
                  {/* Minimalist Color Theme Selector (Color Swatch Icon + Title Only) */}
                  <section className={`rounded-xl border p-3.5 sm:p-4 space-y-2.5 min-w-0 ${surfaceBg}`}>
                    <div className="flex items-center gap-2">
                      <Palette className={`w-4 h-4 shrink-0 ${accentText}`} />
                      <h3 className="text-xs sm:text-sm font-bold font-display">Tema Warna</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs">
                      {[
                        {
                          id: 'graphite_sage' as ColorPresetId,
                          title: 'Graphite Sage',
                          bgSwatch: 'bg-zinc-900 border-zinc-700',
                          dotSwatch: 'bg-teal-500',
                        },
                        {
                          id: 'nordic_slate' as ColorPresetId,
                          title: 'Nordic Slate',
                          bgSwatch: 'bg-slate-900 border-slate-700',
                          dotSwatch: 'bg-sky-400',
                        },
                        {
                          id: 'warm_alabaster' as ColorPresetId,
                          title: 'Warm Alabaster',
                          bgSwatch: 'bg-stone-100 border-stone-300',
                          dotSwatch: 'bg-teal-700',
                        },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleSelectColorPreset(preset.id)}
                          className={`min-h-[44px] px-2.5 py-2 rounded-xl border transition-colors flex items-center justify-center sm:justify-start gap-2 min-w-0 ${
                            colorPreset === preset.id ? activeNavBg : subSurfaceBg
                          }`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${preset.bgSwatch}`}
                          >
                            <span className={`w-2.5 h-2.5 rounded-full ${preset.dotSwatch}`} />
                          </span>
                          <span className="font-semibold truncate text-[11px] sm:text-xs">{preset.title}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-5">
                    <div className={`rounded-xl border p-3.5 sm:p-4 space-y-3.5 min-w-0 ${surfaceBg}`}>
                      <h3 className="text-xs sm:text-sm font-bold font-display flex items-center gap-2">
                        <Bell className={`w-4 h-4 shrink-0 ${accentText}`} />
                        <span>Alert Pop-Up Preferences</span>
                      </h3>
                      <label className="flex items-center justify-between text-xs min-h-[34px]">
                        <span>Sirine Suara Darurat</span>
                        <input
                          type="checkbox"
                          checked={settings.alertPreferences.soundSiren}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              alertPreferences: { ...settings.alertPreferences, soundSiren: e.target.checked },
                            })
                          }
                        />
                      </label>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span>Threshold Wajah:</span>
                          <span className={`font-mono font-semibold ${accentText}`}>{settings.alertPreferences.faceThreshold}</span>
                        </div>
                        <input
                          type="range"
                          min="0.50"
                          max="0.90"
                          step="0.05"
                          value={settings.alertPreferences.faceThreshold}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              alertPreferences: { ...settings.alertPreferences, faceThreshold: parseFloat(e.target.value) },
                            })
                          }
                          className="w-full accent-teal-600"
                        />
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span>Threshold Suara:</span>
                          <span className={`font-mono font-semibold ${accentText}`}>{settings.alertPreferences.dysThreshold}</span>
                        </div>
                        <input
                          type="range"
                          min="0.45"
                          max="0.85"
                          step="0.05"
                          value={settings.alertPreferences.dysThreshold}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              alertPreferences: { ...settings.alertPreferences, dysThreshold: parseFloat(e.target.value) },
                            })
                          }
                          className="w-full accent-teal-600"
                        />
                      </div>
                    </div>

                    <div className={`rounded-xl border p-3.5 sm:p-4 space-y-3.5 min-w-0 ${surfaceBg}`}>
                      <h3 className="text-xs sm:text-sm font-bold font-display flex items-center gap-2">
                        <Sliders className={`w-4 h-4 shrink-0 ${accentText}`} />
                        <span>Display Options</span>
                      </h3>
                      <label className="flex items-center justify-between text-xs min-h-[34px]">
                        <span>Blur Kamera (Privasi)</span>
                        <input
                          type="checkbox"
                          checked={settings.displayOptions.privacyBlurCamera}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              displayOptions: { ...settings.displayOptions, privacyBlurCamera: e.target.checked },
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className={`rounded-xl border p-3.5 sm:p-4 space-y-3.5 min-w-0 ${surfaceBg}`}>
                      <h3 className="text-xs sm:text-sm font-bold font-display flex items-center gap-2">
                        <Cpu className={`w-4 h-4 shrink-0 ${accentText}`} />
                        <span>Device Preferences</span>
                      </h3>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span>Face Hold:</span>
                          <span className={`font-mono font-semibold ${accentText}`}>{settings.devicePreferences.faceHoldSeconds} dtk</span>
                        </div>
                        <input
                          type="range"
                          min="2"
                          max="6"
                          step="1"
                          value={settings.devicePreferences.faceHoldSeconds}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              devicePreferences: {
                                ...settings.devicePreferences,
                                faceHoldSeconds: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full accent-teal-600"
                        />
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span>RMS Gate INMP441:</span>
                          <span className={`font-mono font-semibold ${accentText}`}>{settings.devicePreferences.rmsThreshold}</span>
                        </div>
                        <input
                          type="range"
                          min="0.001"
                          max="0.010"
                          step="0.0005"
                          value={settings.devicePreferences.rmsThreshold}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              devicePreferences: {
                                ...settings.devicePreferences,
                                rmsThreshold: parseFloat(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-teal-600"
                        />
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between">
                          <span>Layar ST7789:</span>
                          <span className={`font-mono font-semibold ${accentText}`}>{settings.devicePreferences.tftBrightness}%</span>
                        </div>
                        <input
                          type="range"
                          min="20"
                          max="100"
                          step="5"
                          value={settings.devicePreferences.tftBrightness}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              devicePreferences: {
                                ...settings.devicePreferences,
                                tftBrightness: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full accent-teal-600"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSaveSettings(settings)}
                      className={`min-h-[42px] w-full sm:w-auto px-5 py-2.5 rounded-xl font-semibold text-xs ${accentBtn}`}
                    >
                      Simpan & Kirim ke ESP32-S3
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ==================== MOBILE BOTTOM TAB BAR ==================== */}
      <nav
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 w-full max-w-full h-16 border-t grid grid-cols-5 items-center px-1 backdrop-blur-md ${surfaceBg}`}
      >
        {[
          { id: 'live_monitor' as ModuleId, label: 'Monitor', icon: Video },
          { id: 'device_health' as ModuleId, label: 'Device', icon: ShieldCheck },
          { id: 'event_history' as ModuleId, label: 'History', icon: History },
          { id: 'family_access' as ModuleId, label: 'Family', icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeModule === tab.id && !mobileMenuOpen;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveModule(tab.id);
                setMobileMenuOpen(false);
              }}
              className={`min-h-[48px] flex flex-col items-center justify-center relative min-w-0 ${
                active ? accentText : 'text-zinc-500'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="text-[10px] font-medium mt-1 truncate max-w-full px-0.5">{tab.label}</span>
            </button>
          );
        })}

        <button
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className={`min-h-[48px] flex flex-col items-center justify-center min-w-0 ${
            mobileMenuOpen || ['account_access', 'app_settings'].includes(activeModule)
              ? accentText
              : 'text-zinc-500'
          }`}
        >
          <Menu className="w-5 h-5 shrink-0" />
          <span className="text-[10px] font-medium mt-1 truncate max-w-full px-0.5">Menu</span>
        </button>
      </nav>
    </div>
  );
}
