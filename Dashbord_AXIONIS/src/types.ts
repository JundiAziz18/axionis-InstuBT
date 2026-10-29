export type CareRole = 'Primary Caregiver' | 'Family Viewer';

export type MachineState =
  | 'IDLE_SCANNING_FACE'
  | 'FACE_HOLD_3S'
  | 'RECORDING_AUDIO_2S'
  | 'MFCC_CNN_INFERENCE'
  | 'ALERT_NORMAL_RESULT';

export type AlertLevel = 'CRITICAL' | 'WARNING' | 'NORMAL';

export type TriggerModality = 'Multimodal' | 'Visual' | 'Audio';

export interface BridgeConfig {
  brokerUrl: string;
  deviceId: string;
  username?: string;
  topicPrefix: string;
  connected: boolean;
  lastError: string | null;
}

export interface DeviceHealth {
  device: string;
  online: boolean;
  rssi: number;
  freePsram: number;
  totalPsram: number;
  freeSram: number;
  uptimeSec: number;
  ip: string;
  lastSeen: string;
  mqttConnected: boolean;
  mqttBroker: string;
}

export interface LiveTelemetry {
  device: string;
  state: MachineState;
  stateProgress: number;
  rms: number;
  faceDetected: boolean;
  faceProb: number;
  dysProb: number;
  holdElapsedSec: number;
  audioRecordSec: number;
  mfccBins: number[];
  waveform: number[];
  snapshotB64?: string | null;
  streamUrl?: string | null;
  landmarkAsymmetry: {
    leftMouthDropMm: number;
    rightMouthDropMm: number;
    eyeApertureRatio: number;
    yawDeg: number;
  };
}

export interface StrokeEvent {
  id: string;
  device: string;
  level: AlertLevel;
  type: string;
  triggerModality: TriggerModality;
  timestamp: string;
  faceProb: number;
  dysProb: number;
  rms: number;
  uptimeSec: number;
  msg: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  clinicalNotes: string | null;
  snapshotMeta: {
    roiResolution: string;
    mouthTiltDeg: number;
    peakFreqHz: number;
    mfccSummary: number[];
    snapshotB64?: string | null;
  };
}

export interface FamilyMember {
  id: string;
  deviceId: string;
  name: string;
  email: string;
  phoneWa: string;
  role: CareRole;
  status: 'Active' | 'Pending';
  viewing: boolean;
  invitedAt: string;
  lastSeenAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  phoneWa: string;
  deviceId: string;
  role: CareRole;
  createdAt: string;
  lastActiveAt: string;
}

export interface AppSettings {
  deviceId: string;
  alertPreferences: {
    soundSiren: boolean;
    browserPush: boolean;
    whatsappForward: boolean;
    faceThreshold: number;
    dysThreshold: number;
  };
  displayOptions: {
    darkMode: boolean;
    privacyBlurCamera: boolean;
    compactTimeline: boolean;
    accessibleFontScale: 'normal' | 'large';
  };
  devicePreferences: {
    rmsThreshold: number;
    faceHoldSeconds: number;
    tftBrightness: number;
  };
}

export interface ActivityLogItem {
  id: string;
  userId: string;
  userName: string;
  userRole: CareRole;
  actionType: 'AUTH' | 'ALERT_ACK' | 'FAMILY_RBAC' | 'DEVICE_CMD' | 'SETTINGS' | 'IOT_BRIDGE';
  description: string;
  timestamp: string;
  metadata?: string;
}

export interface BootstrapPayload {
  bridgeConfig: BridgeConfig;
  deviceHealth: DeviceHealth;
  liveTelemetry: LiveTelemetry;
  eventHistory: StrokeEvent[];
  familyMembers: FamilyMember[];
  users: UserAccount[];
  appSettings: AppSettings;
  activityLogs: ActivityLogItem[];
  activeViewersCount: number;
}
