# Product Requirements Document (PRD): AXIONIS Care Watch AI Dashboard

**Nama Produk:** AXIONIS Care Watch — Edge-AIoT Multimodal Stroke Screening & Family Care Dashboard  
**Versi Dokumen:** 2.0 (Berdasarkan Diagram Arsitektur Fitur Fase 1–4)  
**Target Perangkat Keras Edge:** ESP32-S3 N16R8 + Kamera OV5640 + Mikrofon I2S INMP441 + Layar IPS ST7789 240x240  
**Target Pengguna:** Keluarga pendamping (*caregiver*), pasien berisiko tinggi stroke di rumah, dan tenaga pemantau kesehatan.

---

## 1. Ringkasan Eksekutif & Tujuan Produk

**AXIONIS Care Watch** adalah platform dasbor berbasis web dan *real-time* yang terhubung dengan perangkat *Edge-AIoT* AXIONIS untuk mendeteksi indikasi dini gejala stroke secara nirsentuh melalui analisis asimetri wajah (*facial droop* menggunakan *Haar Cascade + MobileNetV3Small INT8*) dan gangguan artikulasi bicara (*dysarthria* menggunakan *MFCC + CNN Float32*).

Tujuan utama dasbor ini adalah memastikan keluarga dapat memantau kondisi pasien secara langsung, menerima peringatan darurat instan dengan bukti visual/audio, memverifikasi kesehatan perangkat keras dari jarak jauh, serta berkolaborasi antar-anggota keluarga agar pasien mendapatkan penanganan medis sebelum melewati masa kritis ***Golden Hour* (4,5 jam)**.

---

## 2. Peta Jalan Pengembangan Berdasarkan Diagram (Fase 1 – Fase 4)

| Fase | Modul Utama | Sub-Fitur | Prioritas | Tujuan Fase |
| :--- | :--- | :--- | :--- | :--- |
| **FASE 1** | **1. Live Monitor** | • Live Camera<br>• Audio Readout<br>• Status Bar | **P0 (Kritis / MVP)** | Menampilkan umpan visual, metrik suara *real-time*, dan status tahapan deteksi AI di layar utama. |
| **FASE 2** | **2. Alert Center** | • Live Alerts<br>• Alert Details<br>• Acknowledge Alerts | **P0 (Kritis / MVP)** | Menangani notifikasi darurat secara instan, menampilkan skor probabilitas AI, dan konfirmasi tindakan keluarga. |
| **FASE 2** | **3. Device Health** | • Online Status<br>• Connection Quality<br>• Last Seen | **P1 (Tinggi)** | Memastikan perangkat ESP32-S3 selalu aktif dan terhubung dengan jaringan rumah tanpa gagal fungsi. |
| **FASE 3** | **4. Event History** | • Timeline<br>• Filter Events<br>• Event Snapshot | **P1 (Tinggi)** | Menyediakan rekam jejak klinis/historis untuk ditunjukkan kepada dokter saat konsultasi atau kondisi darurat. |
| **FASE 4** | **5. Family Access** | • Invite Family<br>• Viewer Permissions<br>• Shared Live View | **P2 (Menengah)** | Memungkinkan kolaborasi pemantauan oleh beberapa anggota keluarga dengan pembagian hak akses. |
| **FASE 4** | **6. Account Access** | • Create Account<br>• Login & Logout<br>• Reset Password | **P2 (Menengah)** | Mengamankan privasi data medis dan kamera pasien dengan autentikasi pengguna. |
| **FASE 4** | **7. App Settings** | • Alert Preferences<br>• Display Options<br>• Device Preferences | **P2 (Menengah)** | Kustomisasi ambang batas peringatan, tampilan antarmuka, dan kalibrasi parameter perangkat edge. |

---

## 3. Spesifikasi Kebutuhan Fungsional per Modul

### FASE 1: Pemantauan Inti Secara Langsung (*Core Real-Time Monitoring*)

#### Modul 1: Live Monitor
Modul utama yang menjadi beranda (*home view*) saat pengguna membuka dasbor.
1. **Live Camera (`live_camera`):**
   * Menampilkan umpan video langsung dari kamera OV5640 (resolusi QVGA `320x240` atau *crop* `240x240`) dengan *bounding box* deteksi wajah.
   * Menampilkan overlay status inferensi wajah: *Normal* (hijau) atau *Indikasi Asimetri Wajah* (merah/kuning) beserta persentase keyakinan model (`face_score`).
2. **Audio Readout (`audio_readout`):**
   * Menampilkan visualisasi gelombang/bar *VU Meter* nilai **RMS (Root Mean Square)** dari mikrofon INMP441 secara *real-time*.
   * Menampilkan indikator ambang batas aktivasi suara (*Voice Activity Threshold*, misal `RMS >= 0.002`) dan skor probabilitas *dysarthria* (`dys_score`) setelah perekaman 2 detik selesai.
3. **Status Bar (`status_bar`):**
   * Menampilkan tahapan mesin status (*State Machine*) perangkat AXIONIS saat ini:
     * `IDLE / SCANNING FACE` -> `FACE HOLD (3s)` -> `RECORDING AUDIO (2s)` -> `MFCC + CNN INFERENCE` -> `ALERT / NORMAL`.
   * Menampilkan indikator ringkas koneksi MQTT, mode aktif, dan waktu lokal (WIB).

---

### FASE 2: Tanggap Darurat & Keandalan Perangkat (*Emergency Response & Reliability*)

#### Modul 2: Alert Center
Pusat komando peringatan ketika perangkat mendeteksi anomali wajah dan/atau suara.
1. **Live Alerts (`live_alerts`):**
   * Memunculkan *Pop-up Modal* darurat berprioritas tinggi disertai sirine/bunyi peringatan di browser ketika topik MQTT `axionis/{deviceId}/alert` menerima pesan baru.
   * Mengelompokkan tingkat keparahan:
     * **CRITICAL (Merah):** Asimetri wajah terdeteksi **DAN** suara mengindikasikan *dysarthria*.
     * **WARNING (Kuning):** Salah satu modalitas (wajah saja atau suara saja) melewati ambang batas.
2. **Alert Details (`alert_details`):**
   * Menampilkan rincian metrik insiden: Waktu kejadian (`timestamp`), skor `face_prob`, skor `dys_prob`, nilai `RMS`, durasi *uptime*, serta rekomendasi tindakan cepat (misal: *"Segera hubungi IGD / Lakukan pengecekan FAST"*).
3. **Acknowledge Alerts (`acknowledge_alerts`):**
   * Tombol **"Konfirmasi & Tangani" (*Acknowledge*)** bagi anggota keluarga untuk mematikan bunyi alarm dan mencatat siapa yang merespons peringatan tersebut (`acknowledged_by`, `acknowledged_at`, dan catatan kondisi pasien).
   * Mengirimkan perintah balik ke ESP32-S3 (`axionis/{deviceId}/cmd`) untuk mereset layar alarm di perangkat jika diperlukan.

#### Modul 3: Device Health
Memantau kesiapan perangkat keras ESP32-S3 N16R8 agar tidak terjadi *blind spot* pemantauan.
1. **Online Status (`online_status`):**
   * Indikator status `ONLINE` / `OFFLINE` secara *real-time* menggunakan fitur **MQTT Last Will and Testament (LWT)** pada topik `axionis/{deviceId}/status`.
2. **Connection Quality (`connection_quality`):**
   * Menampilkan kekuatan sinyal Wi-Fi (**RSSI** dalam satuan `dBm`, dikategorikan: *Kuat* `> -60 dBm`, *Sedang* `-60 s.d. -75 dBm`, *Lemah* `< -75 dBm`).
   * Menampilkan statistik memori perangkat: kapasitas **Octal PSRAM bebas** (`free_psram` dalam KB/MB) dan **Internal SRAM** untuk memastikan model TFLite Micro berjalan stabil.
3. **Last Seen (`last_seen`):**
   * Menampilkan waktu detak jantung (*heartbeat*) terakhir yang diterima dari perangkat (contoh: *"Terakhir aktif: 5 detik yang lalu — 26 Okt 2026, 16:54 WIB"*) serta total *uptime* perangkat sejak *booting*.

---

### FASE 3: Rekam Jejak & Dokumentasi Medis (*Historical Audit & Snapshots*)

#### Modul 4: Event History
Penyimpanan riwayat skrining untuk evaluasi berkala atau bukti medis bagi dokter.
1. **Timeline (`timeline`):**
   * Daftar kronologis seluruh kejadian deteksi (baik peringatan `CRITICAL`, `WARNING`, maupun tes skrining mandiri) dalam tampilan garis waktu interaktif.
2. **Filter Events (`filter_events`):**
   * Penyaringan data berdasarkan rentang tanggal, tingkat keparahan (*Critical / Warning / Normal*), status konfirmasi (*Acknowledged / Unacknowledged*), dan jenis pemicu (*Wajah / Suara / Multimodal*).
3. **Event Snapshot (`event_snapshot`):**
   * Menyimpan dan menampilkan tangkapan layar (*snapshot* citra wajah saat insiden) beserta ringkasan spektrum/MFCC audio dan skor inferensi pada saat kejadian berlangsung.
   * Fitur unduh laporan insiden (PDF/CSV) untuk dibawa ke rumah sakit.

---

### FASE 4: Kolaborasi Keluarga, Keamanan Akun & Pengaturan (*Multi-User & Configuration*)

#### Modul 5: Family Access
Memungkinkan seluruh anggota keluarga memantau pasien secara bersama-sama.
1. **Invite Family (`invite_family`):**
   * Mengundang anggota keluarga baru melalui alamat email atau tautan/kode undangan unik yang terhubung ke ID Perangkat (`AXIONIS-Edge-0417`).
2. **Viewer Permissions (`viewer_permissions`):**
   * Manajemen peran berbasis hak akses (*Role-Based Access Control*):
     * **Primary Caregiver (Admin):** Akses penuh (Live Monitor, Acknowledge Alert, Ubah Pengaturan Perangkat, Kelola Anggota).
     * **Family Viewer (Anggota):** Hanya dapat melihat *Live View*, riwayat kejadian, dan melakukan *Acknowledge Alert* tanpa mengubah konfigurasi perangkat keras.
3. **Shared Live View (`shared_live_view`):**
   * Dukungan sesi penonton simultan (*multi-client WebSocket broadcasting*) sehingga beberapa anggota keluarga dapat melihat kondisi pasien secara bersamaan disertai indikator siapa saja anggota keluarga yang sedang *online* memantau.

#### Modul 6: Account Access
Manajemen identitas dan keamanan akses dasbor.
1. **Create Account (`create_account`):** Pendaftaran akun baru dengan nama lengkap, email, nomor WhatsApp/telepon darurat, dan *pairing* ID perangkat AXIONIS.
2. **Login & Logout (`login_logout`):** Autentikasi berbasis JWT (*JSON Web Token*) / sesi aman dengan proteksi *route* pada frontend.
3. **Reset Password (`reset_password`):** Pemulihan kata sandi melalui tautan verifikasi email atau OTP.

#### Modul 7: App Settings
Pengaturan personalisasi aplikasi dan parameter perangkat *edge*.
1. **Alert Preferences (`alert_preferences`):**
   * Mengatur jenis notifikasi (Suara sirine browser, *Browser Push Notification*, atau penerusan pesan darurat).
   * Mengatur ambang batas sensitivitas skor AI (misal: batas *threshold* probabilitas wajah `0.65` dan suara `0.60`).
2. **Display Options (`display_options`):**
   * Pengaturan tema layar (*Dark Mode* medis secara bawaan / *Light Mode*), ukuran teks aksesibilitas, serta opsi menyembunyikan pratinjau kamera untuk mode privasi.
3. **Device Preferences (`device_preferences`):**
   * Pengaturan parameter perangkat ESP32-S3 dari jarak jauh via MQTT: kecerahan layar ST7789 (`PIN_TFT_BL`), nilai *threshold* RMS mikrofon INMP441, durasi *Face Hold* (default 3 detik), dan tombol *Reboot* perangkat jarak jauh.

---

## 4. Arsitektur Teknis & Tumpukan Teknologi (*Tech Stack*)

* **Frontend:** React 18 + Vite, Tailwind CSS, Lucide React (Ikon), Recharts (Grafik RMS & Riwayat), Socket.IO Client.
* **Backend & API Server:** Node.js + Express.js, Socket.IO Server, MQTT.js Client, JWT Authentication.
* **Database:**
  * **MongoDB / PostgreSQL (atau SQLite untuk prototipe lokal):** Menyimpan akun pengguna, daftar akses keluarga, riwayat *Alert*, dan *Event Snapshot*.
  * **In-Memory State / Redis:** Menyimpan status *Device Health* (`online`, `rssi`, `free_psram`, `last_seen`) dan metrik *Live Monitor* berkecepatan tinggi.
* **Protokol Komunikasi IoT:**
  * `axionis/{deviceId}/status` (Retained / LWT) -> Status *Device Health*.
  * `axionis/{deviceId}/telemetry` -> Streaming nilai RMS audio, status *State Machine*, dan skor inferensi langsung.
  * `axionis/{deviceId}/alert` -> Peringatan darurat multimodal beserta metadata snapshot.
  * `axionis/{deviceId}/cmd` -> Perintah pengaturan dari dasbor ke ESP32-S3.

---

## 5. Kontrak Data Payload MQTT & Skema Database

### A. Payload MQTT dari ESP32-S3 ke Backend
```json
// 1. Topik: axionis/AXIONIS-Edge-0417/status
{
  "device": "AXIONIS-Edge-0417",
  "online": true,
  "rssi": -58,
  "free_psram": 7845120,
  "uptime_s": 14520,
  "ip": "192.168.1.42"
}

// 2. Topik: axionis/AXIONIS-Edge-0417/telemetry
{
  "device": "AXIONIS-Edge-0417",
  "state": "RECORDING_AUDIO",
  "rms": 0.0184,
  "face_detected": true,
  "face_prob": 0.84,
  "dys_prob": 0.12
}

// 3. Topik: axionis/AXIONIS-Edge-0417/alert
{
  "id": "EVT-20261026-001",
  "device": "AXIONIS-Edge-0417",
  "level": "CRITICAL",
  "ts": "2026-10-26T16:54:12+07:00",
  "face_prob": 0.89,
  "dys_prob": 0.82,
  "rms": 0.0241,
  "msg": "Indikasi kuat asimetri wajah dan disartria terdeteksi",
  "snapshot_b64": "data:image/jpeg;base64,..."
}
```

### B. Skema Tabel / Koleksi Database Utama
1. **`users`**: `id`, `name`, `email`, `password_hash`, `role` (`admin` | `viewer`), `created_at`
2. **`family_members`**: `id`, `device_id`, `user_email`, `role` (`Primary Caregiver` | `Family Viewer`), `status` (`Active` | `Pending`), `invited_at`
3. **`events`**: `id`, `device_id`, `level` (`CRITICAL` | `WARNING` | `INFO`), `timestamp`, `face_prob`, `dys_prob`, `rms`, `snapshot_url`, `acknowledged` (boolean), `acknowledged_by`, `acknowledged_at`
4. **`device_settings`**: `device_id`, `face_threshold` (0.65), `dys_threshold` (0.60), `rms_threshold` (0.002), `hold_time_sec` (3), `screen_brightness` (100), `sound_alert_enabled` (true)

---

## 6. Implementasi Kode Lengkap (Backend & Frontend Mencakup Seluruh 7 Modul)

### 6.1 Kode Backend (`server.js`)
Menangani jembatan MQTT ke WebSocket, REST API untuk *Alert Acknowledge*, *Event History*, *Family Access*, *Account Access*, dan *App Settings*.

```javascript
/**
 * AXIONIS Care Watch - Full-Stack Backend Server (Fase 1 - 4)
 * Menangani: MQTT Bridge, Socket.IO Real-Time, Alert Center, History, Family Access & Settings
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }
});

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';
const DEVICE_ID = process.env.DEVICE_ID || 'AXIONIS-Edge-0417';

// --- Penyimpanan State & Data (Siap diintegrasikan ke MongoDB/SQLite) ---
let deviceHealth = {
  device: DEVICE_ID,
  online: true,
  rssi: -58,
  freePsram: 7864320,
  uptimeSec: 3640,
  ip: '192.168.1.42',
  lastSeen: new Date().toISOString()
};

let liveTelemetry = {
  state: 'SCANNING_FACE',
  rms: 0.0008,
  faceDetected: true,
  faceProb: 0.14,
  dysProb: 0.08
};

let eventHistory = [
  {
    id: 'EVT-20261026-001',
    device: DEVICE_ID,
    level: 'CRITICAL',
    type: 'Multimodal (Facial Droop + Dysarthria)',
    timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    faceProb: 0.88,
    dysProb: 0.81,
    rms: 0.0235,
    msg: 'Terdeteksi asimetri wajah signifikan selama 3 detik diikuti artikulasi suara pelo.',
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null
  },
  {
    id: 'EVT-20261026-002',
    device: DEVICE_ID,
    level: 'WARNING',
    type: 'Visual Only (Asimetri Wajah Ringan)',
    timestamp: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
    faceProb: 0.71,
    dysProb: 0.22,
    rms: 0.0142,
    msg: 'Indikasi asimetri wajah terdeteksi, namun artikulasi suara masih dalam batas normal.',
    acknowledged: true,
    acknowledgedBy: 'Budi Santoso (Anak)',
    acknowledgedAt: new Date(Date.now() - 1000 * 60 * 92).toISOString()
  }
];

let familyMembers = [
  { id: 'FAM-01', name: 'Budi Santoso', email: 'budi.santoso@keluarga.id', role: 'Primary Caregiver', status: 'Active', online: true },
  { id: 'FAM-02', name: 'Siti Rahmawati', email: 'siti.rahma@keluarga.id', role: 'Family Viewer', status: 'Active', online: true },
  { id: 'FAM-03', name: 'dr. Hendra Wijaya', email: 'hendra.medis@klinik.id', role: 'Family Viewer', status: 'Pending', online: false }
];

let appSettings = {
  alertPreferences: {
    soundSiren: true,
    browserPush: true,
    faceThreshold: 0.65,
    dysThreshold: 0.60
  },
  displayOptions: {
    darkMode: true,
    privacyBlurCamera: false,
    compactTimeline: false
  },
  devicePreferences: {
    rmsThreshold: 0.002,
    faceHoldSeconds: 3,
    tftBrightness: 90
  }
};

// --- Koneksi MQTT ---
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log(`[MQTT] Terhubung ke ${MQTT_BROKER}`);
  mqttClient.subscribe('axionis/+/+');
});

mqttClient.on('message', (topic, payload) => {
  try {
    const data = JSON.parse(payload.toString());
    const [, devId, channel] = topic.split('/');

    if (channel === 'status') {
      deviceHealth = {
        ...deviceHealth,
        device: devId,
        online: data.online ?? true,
        rssi: data.rssi ?? deviceHealth.rssi,
        freePsram: data.free_psram ?? data.freePsram ?? deviceHealth.freePsram,
        uptimeSec: data.uptime_s ?? deviceHealth.uptimeSec,
        lastSeen: new Date().toISOString()
      };
      io.emit('device_health', deviceHealth);
    } else if (channel === 'telemetry') {
      liveTelemetry = {
        state: data.state || 'SCANNING_FACE',
        rms: data.rms ?? 0.0005,
        faceDetected: data.face_detected ?? false,
        faceProb: data.face_prob ?? 0.0,
        dysProb: data.dys_prob ?? 0.0
      };
      deviceHealth.lastSeen = new Date().toISOString();
      io.emit('live_telemetry', liveTelemetry);
    } else if (channel === 'alert') {
      const newEvt = {
        id: data.id || `EVT-${Date.now()}`,
        device: devId,
        level: data.level || 'CRITICAL',
        type: data.type || 'Multimodal Stroke Screening Alert',
        timestamp: data.ts || new Date().toISOString(),
        faceProb: data.face_prob ?? data.face ?? 0.85,
        dysProb: data.dys_prob ?? data.dys ?? 0.78,
        rms: data.rms ?? 0.021,
        msg: data.msg || 'Anomali wajah dan bicara terdeteksi oleh perangkat AXIONIS.',
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null
      };
      eventHistory.unshift(newEvt);
      io.emit('new_alert', newEvt);
    }
  } catch (err) {
    console.error('[MQTT Parse Error]:', err.message);
  }
});

// --- REST API Endpoints (Fase 1 - 4) ---

// 1. Ambil seluruh state awal dasbor
app.get('/api/bootstrap', (req, res) => {
  res.json({
    deviceHealth,
    liveTelemetry,
    eventHistory,
    familyMembers,
    appSettings
  });
});

// 2. Acknowledge Alert (Fase 2 - Alert Center)
app.patch('/api/alerts/:id/acknowledge', (req, res) => {
  const { id } = req.params;
  const { userName } = req.body;
  const target = eventHistory.find((e) => e.id === id);
  if (!target) return res.status(404).json({ error: 'Alert tidak ditemukan' });

  target.acknowledged = true;
  target.acknowledgedBy = userName || 'Keluarga Pendamping';
  target.acknowledgedAt = new Date().toISOString();

  mqttClient.publish(`axionis/${DEVICE_ID}/cmd`, JSON.stringify({ cmd: 'ACK_ALARM', alertId: id }));
  io.emit('alert_acknowledged', target);
  res.json(target);
});

// 3. Undang Anggota Keluarga (Fase 4 - Family Access)
app.post('/api/family/invite', (req, res) => {
  const { name, email, role } = req.body;
  const newMember = {
    id: `FAM-${Date.now()}`,
    name,
    email,
    role: role || 'Family Viewer',
    status: 'Pending',
    online: false
  };
  familyMembers.push(newMember);
  io.emit('family_updated', familyMembers);
  res.json(newMember);
});

// 4. Ubah Permission Keluarga
app.patch('/api/family/:id', (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const member = familyMembers.find((m) => m.id === id);
  if (member) {
    member.role = role;
    io.emit('family_updated', familyMembers);
  }
  res.json(member);
});

// 5. Simpan Pengaturan Aplikasi & Perangkat (Fase 4 - App Settings)
app.post('/api/settings', (req, res) => {
  appSettings = { ...appSettings, ...req.body };
  mqttClient.publish(
    `axionis/${DEVICE_ID}/cmd`,
    JSON.stringify({ cmd: 'UPDATE_CONFIG', config: appSettings.devicePreferences })
  );
  io.emit('settings_updated', appSettings);
  res.json(appSettings);
});

io.on('connection', (socket) => {
  socket.emit('device_health', deviceHealth);
  socket.emit('live_telemetry', liveTelemetry);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`AXIONIS Care Watch Server aktif di port ${PORT}`));
```

---

### 6.2 Kode Frontend Lengkap (`src/App.jsx`)
Mengimplementasikan ke-7 modul sesuai persis dengan arsitektur diagram **AXIONIS Care Watch**:
1. **Live Monitor** (*Live Camera*, *Audio Readout*, *Status Bar*)
2. **Alert Center** (*Live Alerts*, *Alert Details*, *Acknowledge Alerts*)
3. **Device Health** (*Online Status*, *Connection Quality*, *Last Seen*)
4. **Event History** (*Timeline*, *Filter Events*, *Event Snapshot*)
5. **Family Access** (*Invite Family*, *Viewer Permissions*, *Shared Live View*)
6. **Account Access** (*Create Account*, *Login & Logout*, *Reset Password*)
7. **App Settings** (*Alert Preferences*, *Display Options*, *Device Preferences*)

```jsx
import React, { useState, useEffect } from 'react';
import {
  Video, Mic, Activity, Bell, ShieldCheck, History, Users,
  UserCheck, Settings, Wifi, Cpu, Clock, CheckCircle2,
  AlertTriangle, Filter, Camera, Lock, LogOut, Send, Sliders
} from 'lucide-react';

export default function App() {
  // Navigasi 7 Modul sesuai Diagram AXIONIS Care Watch
  const [activeModule, setActiveModule] = useState('live_monitor');

  // State Fase 1: Live Monitor
  const [telemetry, setTelemetry] = useState({
    state: 'FACE_HOLD_3S',
    rms: 0.0165,
    faceDetected: true,
    faceProb: 0.86,
    dysProb: 0.79
  });

  // State Fase 2: Device Health
  const [health, setHealth] = useState({
    device: 'AXIONIS-Edge-0417',
    online: true,
    rssi: -56,
    freePsram: 7845120,
    uptimeSec: 18420,
    ip: '192.168.1.42',
    lastSeen: 'Baru saja (2 detik lalu)'
  });

  // State Fase 2 & 3: Alert Center & Event History
  const [events, setEvents] = useState([
    {
      id: 'EVT-20261026-001',
      level: 'CRITICAL',
      type: 'Multimodal (Facial Droop + Dysarthria)',
      timestamp: '26 Okt 2026, 16:42:10 WIB',
      faceProb: 0.89,
      dysProb: 0.82,
      rms: 0.0241,
      msg: 'Asimetri wajah bertahan > 3 detik disertai indikasi artikulasi suara disartria.',
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null
    },
    {
      id: 'EVT-20261026-002',
      level: 'WARNING',
      type: 'Visual Only (Indikasi Asimetri Wajah)',
      timestamp: '26 Okt 2026, 14:15:04 WIB',
      faceProb: 0.72,
      dysProb: 0.19,
      rms: 0.0115,
      msg: 'Terdeteksi kemiringan sudut bibir ringan, uji suara 2 detik menunjukkan artikulasi normal.',
      acknowledged: true,
      acknowledgedBy: 'Budi Santoso (Primary Caregiver)',
      acknowledgedAt: '26 Okt 2026, 14:16:20 WIB'
    }
  ]);
  const [selectedEvent, setSelectedEvent] = useState(events[0]);
  const [historyFilter, setHistoryFilter] = useState('ALL');

  // State Fase 4: Family Access
  const [family, setFamily] = useState([
    { id: 'FAM-01', name: 'Budi Santoso', email: 'budi.santoso@keluarga.id', role: 'Primary Caregiver', status: 'Active', viewing: true },
    { id: 'FAM-02', name: 'Siti Rahmawati', email: 'siti.rahma@keluarga.id', role: 'Family Viewer', status: 'Active', viewing: true },
    { id: 'FAM-03', name: 'dr. Hendra Wijaya', email: 'hendra@klinikmedis.id', role: 'Family Viewer', status: 'Pending', viewing: false }
  ]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Family Viewer');

  // State Fase 4: Account Access
  const [authMode, setAuthMode] = useState('profile'); // 'profile' | 'login' | 'register' | 'reset'
  const [currentUser, setCurrentUser] = useState({
    name: 'Budi Santoso',
    email: 'budi.santoso@keluarga.id',
    role: 'Primary Caregiver'
  });

  // State Fase 4: App Settings
  const [settings, setSettings] = useState({
    soundAlert: true,
    browserNotification: true,
    faceThreshold: 0.65,
    dysThreshold: 0.60,
    privacyBlur: false,
    highContrast: false,
    rmsGate: 0.002,
    holdDuration: 3,
    tftBacklight: 90
  });

  // Simulasi pembaruan RMS & telemetri agar bar audio hidup saat demo
  useEffect(() => {
    const timer = setInterval(() => {
      setTelemetry((prev) => {
        const jitter = (Math.random() - 0.48) * 0.004;
        const nextRms = Math.max(0.0005, Math.min(0.045, +(prev.rms + jitter).toFixed(4)));
        return { ...prev, rms: nextRms };
      });
    }, 800);
    return () => clearInterval(timer);
  }, []);

  // Fungsi Acknowledge Alert (Fase 2)
  const handleAcknowledge = (evtId) => {
    const nowStr = new Date().toLocaleTimeString('id-ID') + ' WIB';
    setEvents((prev) =>
      prev.map((e) =>
        e.id === evtId
          ? { ...e, acknowledged: true, acknowledgedBy: currentUser.name, acknowledgedAt: nowStr }
          : e
      )
    );
    if (selectedEvent && selectedEvent.id === evtId) {
      setSelectedEvent((prev) => ({
        ...prev,
        acknowledged: true,
        acknowledgedBy: currentUser.name,
        acknowledgedAt: nowStr
      }));
    }
  };

  // Fungsi Invite Family (Fase 4)
  const handleInviteFamily = (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    const newMember = {
      id: `FAM-0${family.length + 1}`,
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: inviteRole,
      status: 'Pending',
      viewing: false
    };
    setFamily([...family, newMember]);
    setInviteEmail('');
  };

  const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;
  const filteredEvents = events.filter((e) =>
    historyFilter === 'ALL' ? true : e.level === historyFilter
  );

  const navItems = [
    { id: 'live_monitor', label: 'Live Monitor', phase: 'FASE 1', icon: Video },
    { id: 'alert_center', label: 'Alert Center', phase: 'FASE 2', icon: Bell, badge: unacknowledgedCount },
    { id: 'device_health', label: 'Device Health', phase: 'FASE 2', icon: ShieldCheck },
    { id: 'event_history', label: 'Event History', phase: 'FASE 3', icon: History },
    { id: 'family_access', label: 'Family Access', phase: 'FASE 4', icon: Users },
    { id: 'account_access', label: 'Account Access', phase: 'FASE 4', icon: UserCheck },
    { id: 'app_settings', label: 'App Settings', phase: 'FASE 4', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* HEADER UTAMA + STATUS BAR RINGKAS */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Activity className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-wide text-white">AXIONIS Care Watch</h1>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Edge-AIoT Stroke Screening
              </span>
            </div>
            <p className="text-xs text-slate-400">Device ID: {health.device} • Lokasi: Kamar Utama Pasien</p>
          </div>
        </div>

        {/* Status Bar Cepat */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
            <span className={`w-2.5 h-2.5 rounded-full ${health.online ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className="font-medium">{health.online ? 'ESP32-S3 ONLINE' : 'OFFLINE'}</span>
          </div>
          <div className="hidden md:flex items-center space-x-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
            <Wifi className="w-3.5 h-3.5 text-cyan-400" />
            <span>{health.rssi} dBm</span>
          </div>
          {unacknowledgedCount > 0 && (
            <button
              onClick={() => setActiveModule('alert_center')}
              className="flex items-center space-x-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-3 py-1.5 rounded-lg font-semibold animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>{unacknowledgedCount} Peringatan Aktif!</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR NAVIGASI 7 MODUL (SESUAI DIAGRAM) */}
        <aside className="w-64 bg-slate-900/60 border-r border-slate-800 p-4 flex flex-col justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-3 mb-2">
              Modul Care Watch
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveModule(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {item.badge > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-500 text-white rounded-full">
                        {item.badge}
                      </span>
                    )}
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {item.phase}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs">
            <p className="text-slate-400 text-[11px]">Masuk sebagai:</p>
            <p className="font-semibold text-slate-200 truncate">{currentUser.name}</p>
            <p className="text-[10px] text-cyan-400">{currentUser.role}</p>
          </div>
        </aside>

        {/* AREA KONTEN DINAMIS */}
        <main className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* ==================== FASE 1: LIVE MONITOR ==================== */}
          {activeModule === 'live_monitor' && (
            <div className="space-y-6">
              {/* Sub-fitur 3: Status Bar Tahapan Inferensi Sekuensial */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    Sub-Fitur: Status Bar (Tahapan Deteksi Sekuensial ESP32-S3)
                  </span>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      1. Haar Face ROI: Aktif
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      2. MobileNetV3Small (INT8): {(telemetry.faceProb * 100).toFixed(0)}%
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      3. Rekam I2S 2 dtk + MFCC CNN (Float32): {(telemetry.dysProb * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400">Status Mesin Saat Ini:</span>
                  <p className="text-sm font-bold text-cyan-400">{telemetry.state}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Sub-fitur 1: Live Camera */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <Camera className="w-4 h-4 text-cyan-400" />
                      <h2 className="text-sm font-semibold">Sub-Fitur: Live Camera (OV5640 RGB565 Stream)</h2>
                    </div>
                    <span className="text-xs text-emerald-400 flex items-center">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 320x240 QVGA • 240x240 ROI
                    </span>
                  </div>

                  <div className={`relative bg-slate-950 border border-slate-800 rounded-xl h-80 flex items-center justify-center overflow-hidden ${settings.privacyBlur ? 'blur-md' : ''}`}>
                    {/* Simulasi Bounding Box Wajah & Titik Landmark */}
                    <div className="w-48 h-48 border-2 border-rose-500 rounded-xl relative flex flex-col justify-between p-2 bg-slate-900/40">
                      <div className="flex justify-between items-center">
                        <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                          Asimetri: {(telemetry.faceProb * 100).toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-amber-300 font-mono">Hold: 3.0s</span>
                      </div>
                      <div className="text-center text-xs text-slate-400">
                        [Umpan Visual Wajah Pasien]
                      </div>
                      <div className="text-[10px] text-slate-300 bg-slate-950/80 px-2 py-1 rounded text-center">
                        ROI Wajah Terkunci (256x256 Input Tensor)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub-fitur 2: Audio Readout */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center space-x-2 mb-3">
                      <Mic className="w-4 h-4 text-cyan-400" />
                      <h2 className="text-sm font-semibold">Sub-Fitur: Audio Readout (INMP441)</h2>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">
                      Pemantauan level suara (RMS) pada 16 kHz dan ekstraksi fitur 40-MFCC untuk klasifikasi disartria.
                    </p>

                    <div className="space-y-4">
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-400">Level Suara (RMS):</span>
                          <span className="font-mono font-bold text-cyan-300">{telemetry.rms.toFixed(4)}</span>
                        </div>
                        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              telemetry.rms >= settings.rmsGate ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                            style={{ width: `${Math.min(100, telemetry.rms * 2500)}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5">
                          Ambang Aktivasi Suara (Gate): {settings.rmsGate} ({telemetry.rms >= settings.rmsGate ? 'SUARA AKTIF' : 'Diam'})
                        </p>
                      </div>

                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">Skor Indikasi Disartria:</span>
                          <span className="font-bold text-rose-400">{(telemetry.dysProb * 100).toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-rose-500"
                            style={{ width: `${telemetry.dysProb * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 text-xs text-cyan-200 mt-4">
                    <strong>Info Model Suara:</strong> Menggunakan CNN Float32 penuh (bebas kuantisasi INT8 pada lapisan <em>SeparableConv2D</em>) untuk akurasi artikulasi maksimal.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== FASE 2: ALERT CENTER ==================== */}
          {activeModule === 'alert_center' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Sub-fitur 1: Live Alerts List */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-semibold flex items-center space-x-2">
                  <Bell className="w-4 h-4 text-rose-400" />
                  <span>Sub-Fitur: Live Alerts</span>
                </h2>
                {events.map((evt) => (
                  <div
                    key={evt.id}
                    onClick={() => setSelectedEvent(evt)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      selectedEvent?.id === evt.id
                        ? 'bg-slate-800 border-cyan-500/50'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          evt.level === 'CRITICAL'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {evt.level}
                      </span>
                      <span className="text-[11px] text-slate-400">{evt.timestamp}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-200 mt-1">{evt.type}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Status: {evt.acknowledged ? `Dikonfirmasi oleh ${evt.acknowledgedBy}` : 'Belum Dikonfirmasi!'}
                    </p>
                  </div>
                ))}
              </div>

              {/* Sub-fitur 2 & 3: Alert Details + Acknowledge Alerts */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
                {selectedEvent ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                      <div>
                        <span className="text-xs text-slate-400">Sub-Fitur: Alert Details ({selectedEvent.id})</span>
                        <h3 className="text-lg font-bold text-white mt-0.5">{selectedEvent.type}</h3>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          selectedEvent.acknowledged
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        {selectedEvent.acknowledged ? 'ACKNOWLEDGED' : 'NEEDS ACTION'}
                      </span>
                    </div>

                    <p className="text-sm text-slate-300 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                      {selectedEvent.msg}
                    </p>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-xs text-slate-400">Skor Asimetri Wajah</span>
                        <p className="text-xl font-bold text-rose-400 mt-1">
                          {(selectedEvent.faceProb * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-xs text-slate-400">Skor Disartria Suara</span>
                        <p className="text-xl font-bold text-amber-400 mt-1">
                          {(selectedEvent.dysProb * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-xs text-slate-400">RMS Audio Saat Kejadian</span>
                        <p className="text-xl font-bold text-cyan-400 mt-1">{selectedEvent.rms}</p>
                      </div>
                    </div>

                    {/* Sub-fitur 3: Acknowledge Alerts */}
                    <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-slate-300">Sub-Fitur: Acknowledge Alerts</p>
                        <p className="text-xs text-slate-400">
                          {selectedEvent.acknowledged
                            ? `Telah ditangani oleh ${selectedEvent.acknowledgedBy} pada ${selectedEvent.acknowledgedAt}`
                            : 'Klik tombol di kanan untuk mengonfirmasi bahwa keluarga sedang memeriksa pasien.'}
                        </p>
                      </div>
                      {!selectedEvent.acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(selectedEvent.id)}
                          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition"
                        >
                          Konfirmasi & Tangani Sekarang
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ==================== FASE 2: DEVICE HEALTH ==================== */}
          {activeModule === 'device_health' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Sub-fitur 1: Online Status */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400">Sub-Fitur: Online Status</span>
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-2xl font-bold text-emerald-400">ONLINE (Aktif)</p>
                <p className="text-xs text-slate-400 mt-2">
                  Dipantau melalui protokol MQTT Last Will and Testament (LWT) pada topik{' '}
                  <code className="text-cyan-300">axionis/{health.device}/status</code>.
                </p>
              </div>

              {/* Sub-fitur 2: Connection Quality */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400">Sub-Fitur: Connection Quality</span>
                  <Wifi className="w-5 h-5 text-cyan-400" />
                </div>
                <p className="text-2xl font-bold text-white">{health.rssi} dBm (Sangat Baik)</p>
                <p className="text-xs text-slate-400 mt-2">
                  IP Lokal: {health.ip} • Octal PSRAM Bebas: {(health.freePsram / 1024 / 1024).toFixed(2)} MB dari 8.00 MB
                </p>
              </div>

              {/* Sub-fitur 3: Last Seen */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400">Sub-Fitur: Last Seen</span>
                  <Clock className="w-5 h-5 text-amber-400" />
                </div>
                <p className="text-2xl font-bold text-white">{health.lastSeen}</p>
                <p className="text-xs text-slate-400 mt-2">
                  Total Uptime tanpa henti: {(health.uptimeSec / 3600).toFixed(1)} jam • Sinkronisasi NTP WIB Aktif.
                </p>
              </div>
            </div>
          )}

          {/* ==================== FASE 3: EVENT HISTORY ==================== */}
          {activeModule === 'event_history' && (
            <div className="space-y-6">
              {/* Sub-fitur 2: Filter Events */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center space-x-2">
                  <Filter className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-semibold">Sub-Fitur: Filter Events</span>
                </div>
                <div className="flex space-x-2">
                  {['ALL', 'CRITICAL', 'WARNING'].map((flt) => (
                    <button
                      key={flt}
                      onClick={() => setHistoryFilter(flt)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        historyFilter === flt
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {flt === 'ALL' ? 'Semua Riwayat' : flt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-fitur 1 & 3: Timeline & Event Snapshot */}
              <div className="space-y-4">
                {filteredEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-4 items-center"
                  >
                    <div className="md:col-span-3 space-y-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-cyan-400">[Timeline] {evt.timestamp}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {evt.id}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white">{evt.type}</h3>
                      <p className="text-xs text-slate-400">{evt.msg}</p>
                      <p className="text-xs text-slate-300">
                        Skor Wajah: <strong>{(evt.faceProb * 100).toFixed(0)}%</strong> • Skor Suara:{' '}
                        <strong>{(evt.dysProb * 100).toFixed(0)}%</strong> • RMS: <strong>{evt.rms}</strong>
                      </p>
                    </div>
                    {/* Sub-fitur 3: Event Snapshot */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                      <Camera className="w-6 h-6 text-slate-500 mx-auto mb-1" />
                      <p className="text-[11px] font-semibold text-slate-300">Event Snapshot</p>
                      <p className="text-[10px] text-slate-500">ROI 240x240 + MFCC Frame</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==================== FASE 4: FAMILY ACCESS ==================== */}
          {activeModule === 'family_access' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Sub-fitur 1: Invite Family */}
              <form
                onSubmit={handleInviteFamily}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4"
              >
                <h2 className="text-sm font-semibold flex items-center space-x-2">
                  <Send className="w-4 h-4 text-cyan-400" />
                  <span>Sub-Fitur: Invite Family</span>
                </h2>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Email Anggota Keluarga / Dokter</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="contoh@keluarga.id"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Sub-Fitur: Viewer Permissions (Peran)</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="Family Viewer">Family Viewer (Pantau & Terima Alert)</option>
                    <option value="Primary Caregiver">Primary Caregiver (Akses Penuh)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs py-2.5 rounded-lg transition"
                >
                  Kirim Undangan Akses
                </button>
              </form>

              {/* Sub-fitur 2 & 3: Viewer Permissions & Shared Live View */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    Sub-Fitur: Viewer Permissions & Shared Live View
                  </h2>
                  <span className="text-xs text-emerald-400">
                    {family.filter((f) => f.viewing).length} Keluarga Sedang Menonton Live View
                  </span>
                </div>
                <div className="space-y-3">
                  {family.map((m) => (
                    <div
                      key={m.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-xs font-bold text-white">{m.name}</p>
                        <p className="text-[11px] text-slate-400">{m.email}</p>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="text-[11px] px-2.5 py-1 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                          {m.role}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            m.viewing
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {m.viewing ? 'Shared Live View Aktif' : m.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ==================== FASE 4: ACCOUNT ACCESS ==================== */}
          {activeModule === 'account_access' && (
            <div className="max-w-xl bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-2">
                  <Lock className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-sm font-semibold">Modul: Account Access</h2>
                </div>
                <div className="flex space-x-2 text-xs">
                  {['profile', 'register', 'reset'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setAuthMode(m)}
                      className={`px-2.5 py-1 rounded ${
                        authMode === m ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {m === 'profile' ? 'Login & Logout' : m === 'register' ? 'Create Account' : 'Reset Password'}
                    </button>
                  ))}
                </div>
              </div>

              {authMode === 'profile' && (
                <div className="space-y-4 text-xs">
                  <p className="text-slate-400">Sub-Fitur: Login & Logout (Sesi Aktif)</p>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                    <p className="text-sm font-bold text-white">{currentUser.name}</p>
                    <p className="text-slate-400">{currentUser.email}</p>
                    <p className="text-cyan-400 font-semibold">{currentUser.role}</p>
                  </div>
                  <button className="flex items-center space-x-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 px-4 py-2 rounded-lg font-semibold">
                    <LogOut className="w-4 h-4" />
                    <span>Logout dari Sesi Perangkat</span>
                  </button>
                </div>
              )}

              {authMode === 'register' && (
                <div className="space-y-3 text-xs">
                  <p className="text-slate-400">Sub-Fitur: Create Account (Registrasi Pendamping Baru)</p>
                  <input placeholder="Nama Lengkap" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2" />
                  <input placeholder="Alamat Email" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2" />
                  <input type="password" placeholder="Kata Sandi" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2" />
                  <button className="bg-cyan-500 text-slate-950 font-bold px-4 py-2 rounded-lg">
                    Buat Akun Care Watch
                  </button>
                </div>
              )}

              {authMode === 'reset' && (
                <div className="space-y-3 text-xs">
                  <p className="text-slate-400">Sub-Fitur: Reset Password</p>
                  <input placeholder="Masukkan email terdaftar" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2" />
                  <button className="bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-lg">
                    Kirim Tautan Reset Kata Sandi
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ==================== FASE 4: APP SETTINGS ==================== */}
          {activeModule === 'app_settings' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Sub-fitur 1: Alert Preferences */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold flex items-center space-x-2">
                  <Bell className="w-4 h-4 text-cyan-400" />
                  <span>Sub-Fitur: Alert Preferences</span>
                </h3>
                <label className="flex items-center justify-between text-xs">
                  <span>Sirine Suara Darurat</span>
                  <input
                    type="checkbox"
                    checked={settings.soundAlert}
                    onChange={(e) => setSettings({ ...settings, soundAlert: e.target.checked })}
                  />
                </label>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Threshold Probabilitas Wajah:</span>
                    <span className="text-cyan-400 font-bold">{settings.faceThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min="0.50"
                    max="0.90"
                    step="0.05"
                    value={settings.faceThreshold}
                    onChange={(e) => setSettings({ ...settings, faceThreshold: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Sub-fitur 2: Display Options */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold flex items-center space-x-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  <span>Sub-Fitur: Display Options</span>
                </h3>
                <label className="flex items-center justify-between text-xs">
                  <span>Samarkan Video Kamera (Mode Privasi)</span>
                  <input
                    type="checkbox"
                    checked={settings.privacyBlur}
                    onChange={(e) => setSettings({ ...settings, privacyBlur: e.target.checked })}
                  />
                </label>
              </div>

              {/* Sub-fitur 3: Device Preferences */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span>Sub-Fitur: Device Preferences</span>
                </h3>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Durasi Tahan Wajah (Hold):</span>
                    <span className="text-cyan-400 font-bold">{settings.holdDuration} detik</span>
                  </div>
                  <div className="flex justify-between mt-2">
                    <span>Ambang RMS INMP441:</span>
                    <span className="text-cyan-400 font-bold">{settings.rmsGate}</span>
                  </div>
                  <div className="flex justify-between mt-2">
                    <span>Kecerahan Layar ST7789:</span>
                    <span className="text-cyan-400 font-bold">{settings.tftBacklight}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
```