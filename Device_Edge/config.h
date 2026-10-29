#pragma once
#include <Arduino.h>

#define FW_VERSION   "1.0"
#define DEVICE_ID    "AXIONIS-Edge-0417"

// ===================== LAYAR ST7789 240x240 (7 pin, tanpa CS) =====================
// Pin dipindahkan ke GPIO bebas agar tidak bentrok dengan kamera
#define PIN_TFT_SCK    3
#define PIN_TFT_MOSI   14
#define PIN_TFT_RST    21
#define PIN_TFT_BL     38
#define PIN_TFT_DC     39

// ===================== MIKROFON INMP441 (L/R ke GND = kanal kiri) =====================
#define PIN_I2S_WS     1
#define PIN_I2S_SCK    2
#define PIN_I2S_SD     42

// ===================== KAMERA (tersambung langsung di board ESP32-S3) =====================
// 1 = ESP32-S3-WROOM CAM umum (XCLK15, SIOD4, SIOC5, VSYNC6, HREF7, PCLK13, ...)
// 0 = CUSTOM: isi sendiri dari skematik board kamu
#define CAM_BOARD_PROFILE 1

#if CAM_BOARD_PROFILE == 1
  #define CAM_PWDN  -1
  #define CAM_RESET -1
  #define CAM_XCLK  15
  #define CAM_SIOD  4
  #define CAM_SIOC  5
  #define CAM_D0    11   // Y2
  #define CAM_D1    9    // Y3
  #define CAM_D2    8    // Y4
  #define CAM_D3    10   // Y5
  #define CAM_D4    12   // Y6
  #define CAM_D5    18   // Y7
  #define CAM_D6    17   // Y8
  #define CAM_D7    16   // Y9
  #define CAM_VSYNC 6
  #define CAM_HREF  7
  #define CAM_PCLK  13
#else
  #define CAM_PWDN  -1
  #define CAM_RESET -1
  #define CAM_XCLK  -1
  #define CAM_SIOD  -1
  #define CAM_SIOC  -1
  #define CAM_D0 -1
  #define CAM_D1 -1
  #define CAM_D2 -1
  #define CAM_D3 -1
  #define CAM_D4 -1
  #define CAM_D5 -1
  #define CAM_D6 -1
  #define CAM_D7 -1
  #define CAM_VSYNC -1
  #define CAM_HREF  -1
  #define CAM_PCLK  -1
#endif
#define CAM_XCLK_HZ  20000000
#define CAM_VFLIP    1      // 1 jika gambar terbalik
#define CAM_HMIRROR  0

// Pengaman: pin layar/mikrofon tidak boleh sama dengan pin kamera.
// Jika error muncul di sini, cek skematik board kamu (jangan dimatikan sebelum pin benar).
namespace pincheck {
constexpr int peri[] = {PIN_TFT_SCK, PIN_TFT_MOSI, PIN_TFT_RST, PIN_TFT_BL, PIN_TFT_DC,
                        PIN_I2S_WS, PIN_I2S_SCK, PIN_I2S_SD};
constexpr int cam[]  = {CAM_XCLK, CAM_SIOD, CAM_SIOC, CAM_VSYNC, CAM_HREF, CAM_PCLK,
                        CAM_D0, CAM_D1, CAM_D2, CAM_D3, CAM_D4, CAM_D5, CAM_D6, CAM_D7};
constexpr bool ok() {
  for (int a : peri) for (int b : cam) if (a >= 0 && a == b) return false;
  return true;
}
}  // namespace pincheck
#ifndef ALLOW_PIN_CLASH
static_assert(pincheck::ok(), "BENTROK PIN: ada pin layar/INMP441 yang sama dengan pin kamera. Cek skematik board.");
#endif

// ===================== VISI (disamakan dengan notebook training) =====================
#define FACE_IDX_STROKE       1       // output model gambar: [0]=Normal, [1]=Stroke
#define FACE_STROKE_THRESH   0.80f
#define FACE_MIN_POSITIVE    2       // minimal frame positif berturut-turut
#define FACE_HOLD_MS         3000    // anomali harus bertahan selama ini (proposal: 3 detik)
#define FACE_CROP_MARGIN     0.15f   // margin di sekitar kotak Haar (sesuaikan dengan crop training)
#define HAAR_MIN_SIZE        24      // lebar wajah minimum pada gambar deteksi 160x120 (=48 px di QVGA)
#define HAAR_SCALE           1.2f
#define HAAR_MIN_NEIGHBORS   3

// ===================== AUDIO =====================
#define AUDIO_SAMPLE_RATE    16000   // training: 16 kHz
#define AUDIO_SECONDS        2       // training: 2 detik -> 63 frame MFCC
#define AUDIO_GAIN           1.0f    // kalibrasi level mic vs data training (lihat log RMS)
#define AUDIO_MIN_RMS        0.002f  // di bawah ini dianggap diam
#define AUDIO_DYS_THRESH     0.50f   // sigmoid tunggal: 1 = disartria
#define AUDIO_PROMPT_MS      1500
#define AUDIO_RETRY_MS       10000   // jeda sebelum validasi suara diulang bila hasilnya normal

// ===================== ALARM & JARINGAN =====================
#define ALARM_MS             20000   // lama layar peringatan merah
#define COOLDOWN_MS          60000   // jeda sebelum alarm berikutnya boleh muncul

#define WIFI_SSID   "Infy"
#define WIFI_PASS   "123459876"
#define MQTT_HOST   "l111b1a4.ala.asia-southeast1.emqxsl.com"
#define MQTT_PORT   8883
#define MQTT_USER   "device_axsionisBT"
#define MQTT_PASS   "Axsionis_123345"
#define MQTT_USE_TLS 1              // 0 = Tanpa TLS (Port 1883), 1 = Dengan TLS/SSL (Port 8883)
#define MQTT_CA_CERT ""             // Sertifikat CA jika MQTT_USE_TLS set ke 1
#define MQTT_TOPIC_ALERT     "axionis/" DEVICE_ID "/alert"
#define MQTT_TOPIC_STATUS    "axionis/" DEVICE_ID "/status"
#define MQTT_TOPIC_CAMERA    "axionis/" DEVICE_ID "/camera"
#define MQTT_TOPIC_TELEMETRY "axionis/" DEVICE_ID "/telemetry"
#define MQTT_TOPIC_CMD       "axionis/" DEVICE_ID "/command"
#define NTP_SERVER          "pool.ntp.org"
#define STATUS_PERIOD_MS    30000
#define ALERT_TIMEOUT_MS    120000   // berhenti mencoba kirim setelah ini

// ===================== TFLM =====================
#define FACE_ARENA_BYTES     (2 * 1024 * 1024)   // lihat log "arena dipakai", lalu kecilkan
#define AUDIO_ARENA_BYTES    (512 * 1024)
#define TFLM_LEGACY_API      0   // 1 jika library TFLM lama (MicroInterpreter butuh error_reporter)