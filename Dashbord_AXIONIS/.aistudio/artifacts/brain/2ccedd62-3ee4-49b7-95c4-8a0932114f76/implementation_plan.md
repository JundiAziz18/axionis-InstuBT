# AXIONIS Care Watch — Edge-AIoT Multimodal Stroke Screening & Family Care Dashboard

Platform dasbor pemantauan medis berbasis web secara *real-time* yang terhubung dengan perangkat *Edge-AIoT* **AXIONIS** (`ESP32-S3 N16R8 + Kamera OV5640 + Mikrofon INMP441 + Layar ST7789`) untuk deteksi dini gejala stroke nirsentuh (asimetri wajah & disartria bicara), dilengkapi basis data persisten untuk manajemen pengguna, kolaborasi akses keluarga, dan pelacakan log aktivitas secara langsung.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Berikut adalah rangkuman keputusan arsitektur dan pengalaman pengguna berdasarkan preferensi yang telah dikonfirmasi serta standar terbaik untuk lingkungan produksi:

- **Visualisasi Live Monitor (Dikonfirmasi)**: Menggunakan **visualisasi simulasi kanvas interaktif** (umpan wajah sintetis QVGA `320x240` dengan ROI `240x240`, *facial landmark points*, dan *bounding box* asimetri wajah) serta **gelombang audio sintetis & VU Meter RMS** tanpa meminta izin akses kamera/mikrofon perangkat pengguna.
- **Basis Data & Autentikasi (Rekomendasi Default)**: Menggunakan **SQLite Persisten (`better-sqlite3`)** di sisi server Express dengan autentikasi sesi JWT/Email. Seluruh akun pengguna, hak akses keluarga (*Role-Based Access Control*), riwayat insiden (*Event History*), pengaturan perangkat, dan **log jejak aktivitas pengguna (*Real-Time User Activity Tracking*)** disimpan secara permanen di database lokal dan disinkronkan seketika ke seluruh klien via **Socket.IO**.
- **Jembatan MQTT & Simulator Perangkat Bawaan (Rekomendasi Default)**: Backend terhubung ke broker MQTT (`mqtt.js`) sesuai kontrak topik `axionis/{deviceId}/+` **sekaligus** menyediakan panel **Simulator Edge ESP32-S3 Interaktif** di dasbor agar Anda dapat menguji seluruh tahapan *State Machine* (`IDLE / SCANNING FACE` → `FACE HOLD 3s` → `RECORDING AUDIO 2s` → `MFCC + CNN INFERENCE` → `ALERT / NORMAL`) serta memicu skenario *Critical/Warning Alert* secara instan.

---

## 1. Overview & Core Concept

- **What It Does**: Menyediakan pusat komando keluarga dan tenaga medis untuk memantau skrining stroke multimodal dari perangkat *edge* AXIONIS, mengelola peringatan darurat dalam masa kritis *Golden Hour* (4,5 jam), mengaudit rekam jejak klinis beserta *snapshot* visual/MFCC, mengatur kolaborasi keluarga dengan pembagian peran, dan melacak seluruh aktivitas pengguna secara *real-time*.
- **Target Audience / Persona**:
  - **Primary Caregiver (Admin Keluarga)**: Mengelola konfigurasi perangkat ESP32-S3, mengundang anggota keluarga/dokter, memantau *Live View*, dan mengonfirmasi penanganan peringatan (*Acknowledge Alert*).
  - **Family Viewer (Anggota Keluarga / Dokter Pendamping)**: Memantau *Shared Live View* secara bersamaan, melihat riwayat klinis & mengunduh laporan PDF/CSV, serta merespons peringatan darurat tanpa mengubah kalibrasi perangkat keras.
- **Key Value**: Deteksi dini dan koordinasi tanggap darurat keluarga yang terdokumentasi penuh dengan bukti kuantitatif (`face_prob`, `dys_prob`, `RMS`) dan audit log aktivitas pengguna secara langsung.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Autentikasi & Pelacakan Sesi (`Account Access`)**: Pengguna masuk menggunakan akun Caregiver/Viewer (tersedia pula *Quick Role Switcher* untuk pengujian multi-peran dengan cepat), mendaftarkan akun baru dengan nomor darurat WhatsApp & *pairing* ID perangkat (`AXIONIS-Edge-0417`), atau memulihkan kata sandi. Setiap login, perubahan pengaturan, dan konfirmasi alarm langsung tercatat di **Real-Time Activity Log**.
2. **Pemantauan Langsung (`Live Monitor` - Fase 1)**:
   - Melihat **Status Bar Sekuensial** yang menyorot tahapan aktif mesin inferensi ESP32-S3.
   - Memantau kanvas **Live Camera OV5640** dengan *overlay* geometri wajah, indikator durasi tahan (*Face Hold 3.0s*), dan persentase `face_score`.
   - Memantau **Audio Readout INMP441** dengan grafik gelombang berjalan, *VU Meter* RMS terhadap ambang aktivasi (`RMS >= 0.002`), dan skor disartria CNN Float32 (`dys_score`).
3. **Tanggap Darurat (`Alert Center` & `Device Health` - Fase 2)**:
   - Ketika terdeteksi anomali **CRITICAL** (wajah + suara) atau **WARNING** (salah satu modalitas), muncul *Emergency Modal Banner* dengan sirine audio sintetis (Web Audio API) dan panduan tindakan cepat metode **FAST** (*Face, Arms, Speech, Time*).
   - Anggota keluarga menekan **"Konfirmasi & Tangani" (*Acknowledge*)** beserta catatan kondisi pasien; status langsung diperbarui di semua layar keluarga yang sedang aktif dan mengirim perintah `ACK_ALARM` ke topik MQTT `axionis/{deviceId}/cmd`.
   - Memeriksa kesehatan perangkat keras ESP32-S3 (`ONLINE/OFFLINE` LWT, kualitas sinyal Wi-Fi RSSI `dBm`, kapasitas memori *Octal PSRAM* 8MB & SRAM, serta *uptime* dan *Last Seen*).
4. **Audit Klinis & Unduh Laporan (`Event History` - Fase 3)**:
   - Menyaring riwayat insiden berdasarkan tingkat keparahan (`ALL`, `CRITICAL`, `WARNING`, `NORMAL`), jenis pemicu (*Multimodal*, *Wajah*, *Suara*), status konfirmasi, dan pencarian kata kunci.
   - Membuka detail **Event Snapshot** (visualisasi tangkapan ROI wajah `240x240` + spektrogram 40-MFCC saat kejadian) dan mengekspor laporan insiden dalam format **CSV** atau **Cetak/PDF Medis**.
5. **Kolaborasi Keluarga & Log Aktivitas (`Family Access` & `App Settings` - Fase 4)**:
   - Mengundang anggota keluarga/dokter baru, mengubah hak akses (*Primary Caregiver* vs *Family Viewer*), melihat daftar penonton aktif di **Shared Live View**, serta memantau **Tabel Log Aktivitas Pengguna Real-Time** (siapa melakukan apa dan kapan).
   - Mengatur sensitivitas ambang AI (`face_threshold`, `dys_threshold`), mode privasi kamera (*blur*), tema tampilan (*Dark/Light Mode*), dan kalibrasi parameter perangkat keras jarak jauh (RMS Gate, Face Hold, kecerahan layar ST7789, dan *Remote Reboot*).

### Visual Identity & Theme
- **Aesthetic Direction**: *Clinical Precision & High-Reliability Telemetry* — antarmuka instrumen medis modern yang bersih, tenang, kontras tinggi (WCAG AA), dan bebas dekorasi berlebihan agar informasi darurat terbaca dalam hitungan milidetik.
- **Color Palette & Mood**:
  - **Dominant Canvas (60%)**: Deep Clinical Slate (`#0B1120` / `slate-950`) pada mode gelap bawaan, serta dukungan *Light Mode* (`#F8FAFC` / `slate-50`) melalui pengaturan tampilan.
  - **Structural Surfaces (30%)**: Elevated Instrument Surface (`#0F172A` / `slate-900`) dengan garis pemisah presisi `1px solid` (`#1E293B` / `slate-800`).
  - **Semantic & Accent Budget (10%)**:
    - Primary Medical Cyan (`#06B6D4` / `cyan-500`) untuk fokus aktif dan telemetri.
    - Nominal Emerald (`#10B981` / `emerald-500`) untuk status perangkat normal & terkonfirmasi.
    - Warning Amber (`#F59E0B` / `amber-500`) untuk anomali modalitas tunggal.
    - Critical Crimson (`#F43F5E` / `rose-500`) untuk peringatan darurat stroke multimodal.
- **Typography & Hierarchy**:
  - **Display & Navigation**: `Plus Jakarta Sans` (SemiBold/Bold) untuk struktur modul dan judul yang tegas.
  - **Body & Clinical Notes**: `DM Sans` (Regular/Medium) untuk keterbacaan optimal pada ukuran `12px–15px`.
  - **Telemetry & Numerals**: `JetBrains Mono` dengan `tabular-nums` (`font-variant-numeric: tabular-nums`) pada seluruh skor probabilitas, nilai RMS, RSSI dBm, PSRAM, dan stempel waktu WIB agar angka tidak bergeser saat *streaming* langsung.
- **Component Styling & Layout**:
  - Dirancang penuh untuk layar desktop (`1440px`) dan responsif penuh di tablet/ponsel: Sidebar navigasi 7 modul + Top Bar 3-Zona sesuai kontrak desain + Area kerja utama dengan *Single-Elevation Depth*.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Arsitektur Full-Stack SQLite + Socket.IO + MQTT Bridge**
  - *Chosen Approach*: Menjalankan server Express + Socket.IO + SQLite (`better-sqlite3`) pada port 3000 bersama Vite middleware.
  - *Why*: Memenuhi kebutuhan penyimpanan permanen untuk manajemen pengguna, peran keluarga, riwayat kejadian, dan pelacakan aktivitas *real-time* antar-tab/perangkat tanpa latensi eksternal, sembari tetap terhubung ke broker MQTT standar (`axionis/+/+`).
- **Decision 2: Simulator Perangkat Keras ESP32-S3 Terintegrasi di Server**
  - *Chosen Approach*: Menyediakan mesin simulasi *State Machine* di sisi server yang dapat dikontrol langsung dari UI (Mode Normal, Skenario Gejala Ringan/Warning, Skenario Darurat Stroke/Critical, atau Ubah Tahapan Manual).
  - *Why*: Tanpa perangkat fisik ESP32-S3 yang menyala setiap saat, penguji dan keluarga tetap dapat merasakan aliran telemetri `800ms`, transisi tahapan deteksi sekuensial, *pop-up* sirine darurat, dan respons balik perintah MQTT secara nyata.
- **Decision 3: Pelacakan Aktivitas Pengguna Real-Time (`user_activities`)**
  - *Chosen Approach*: Menambahkan tabel khusus `activity_logs` di database yang mencatat setiap aksi pengguna (Login, Logout, Acknowledge Alert, Invite Family, Update Permission, Calibrate Device, Reboot, Trigger Test) dan menyiarkannya langsung via WebSocket.
  - *Why*: Menjawab kebutuhan eksplisit pelacakan aktivitas pengguna secara *real-time* untuk audit kolaborasi keluarga dan akuntabilitas penanganan medis pasien.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT: REACT 19 + TAILWIND CSS                           │
│                                                                                   │
│  ┌──────────────────────┐  ┌───────────────────────────────────────────────────┐  │
│  │ Top Bar (3-Zone)     │  │ Emergency Alert Modal & Web Audio Siren           │  │
│  │ Brand · Nav · Action │  │ Instant Pop-up on CRITICAL/WARNING + FAST Guide   │  │
│  └──────────────────────┘  └───────────────────────────────────────────────────┘  │
│  ┌──────────────────────┐  ┌───────────────────────────────────────────────────┐  │
│  │ Sidebar (Fase 1 - 4) │  │ Main Viewport (7 Modules + Activity Stream)       │  │
│  │ • 1. Live Monitor    │  │ • Fase 1: Synthetic OV5640 Canvas + INMP441 Wave  │  │
│  │ • 2. Alert Center    │  │ • Fase 2: Alert Details/Ack + ESP32-S3 Health     │  │
│  │ • 3. Device Health   │  │ • Fase 3: Timeline Filter + Snapshot + CSV/Print  │  │
│  │ • 4. Event History   │  │ • Fase 4: Family RBAC & Shared View + Auth +      │  │
│  │ • 5. Family Access   │  │           App/Edge Settings + Live Activity Log   │  │
│  │ • 6. Account Access  │  └───────────────────────────────────────────────────┘  │
│  │ • 7. App Settings    │  ┌───────────────────────────────────────────────────┐  │
│  └──────────────────────┘  │ Interactive ESP32-S3 Telemetry & Alert Simulator  │  │
│                            └───────────────────────────────────────────────────┘  │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        │ REST API (/api/*) & Socket.IO (Real-Time)
┌───────────────────────────────────────▼───────────────────────────────────────────┐
│                      SERVER: NODE.JS + EXPRESS + SOCKET.IO                        │
│                                                                                   │
│  ┌────────────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │ Auth, RBAC & Activity API  │  │ Edge State Engine & │  │ SQLite Database    │  │
│  │ • /api/auth (Login/Reg/Rst)│  │ MQTT.js Bridge      │  │ (axionis.db)       │  │
│  │ • /api/family (Invite/Role)│  │ • axionis/+/status  │  │ • users            │  │
│  │ • /api/alerts/:id/ack      │  │ • axionis/+/tele... │  │ • family_members   │  │
│  │ • /api/settings & /cmd     │  │ • axionis/+/alert   │  │ • events           │  │
│  │ • /api/activities          │  │ • axionis/+/cmd     │  │ • device_settings  │  │
│  └────────────────────────────┘  └─────────────────────┘  │ • activity_logs    │  │
│                                                           └────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State (SQLite Schema)
1. **`users`**: `id`, `name`, `email`, `password_hash`, `phone_wa`, `device_id`, `role` (`Primary Caregiver` | `Family Viewer`), `last_active`, `created_at`.
2. **`family_members`**: `id`, `device_id`, `name`, `email`, `role` (`Primary Caregiver` | `Family Viewer`), `status` (`Active` | `Pending`), `viewing` (boolean status sesi langsung), `invited_at`.
3. **`events`**: `id`, `device_id`, `level` (`CRITICAL` | `WARNING` | `NORMAL`), `type`, `trigger_modality` (`Multimodal` | `Visual` | `Audio`), `timestamp`, `face_prob`, `dys_prob`, `rms`, `msg`, `snapshot_meta` (JSON koordinat ROI & spektrum MFCC), `acknowledged` (boolean), `acknowledged_by`, `acknowledged_at`, `clinical_notes`.
4. **`device_settings`**: `device_id`, `sound_siren`, `browser_push`, `face_threshold`, `dys_threshold`, `dark_mode`, `privacy_blur_camera`, `compact_timeline`, `rms_threshold`, `face_hold_seconds`, `tft_brightness`, `updated_at`.
5. **`activity_logs`**: `id`, `user_id`, `user_name`, `user_role`, `action_type` (`AUTH`, `ALERT_ACK`, `FAMILY_RBAC`, `DEVICE_CMD`, `SETTINGS`, `SIMULATION`), `description`, `timestamp`.

### Interactive Component & State Mapping
- **Live Monitor Canvas & Audio Visualizer**: Menggambar siluet/vektor wajah sintetis pada `<canvas>` lengkap dengan *bounding box* dinamis yang berubah warna (Hijau Normal / Kuning Warning / Merah Critical) sesuai `faceProb`, indikator *Face Hold Timer*, serta grafik bar spektrum 40-MFCC dan gelombang RMS secara *real-time*.
- **Alert Center & Emergency Modal**: Ketika event `new_alert` diterima via Socket.IO, memicu modal darurat (jika belum dikonfirmasi) dan bunyi alarm Web Audio API (bisa dibisukan). Mengisi catatan kondisi pasien dan menekan *Acknowledge* akan memperbarui SQLite, mencatat ke `activity_logs`, menyiarkan `alert_acknowledged` ke seluruh klien, dan mempublikasikan payload `ACK_ALARM` ke MQTT.
- **Family Access & Real-Time Activity Tracker**: Melacak jumlah klien WebSocket yang sedang membuka dasbor (`Shared Live View`), mengizinkan *Primary Caregiver* mengundang anggota baru, mengubah peran, atau menghapus akses, serta menampilkan umpan langsung seluruh aktivitas pengguna yang tersimpan di database.
