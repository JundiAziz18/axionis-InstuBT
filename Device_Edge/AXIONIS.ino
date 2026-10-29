// AXIONIS firmware v1.0 (ESP32-S3 N16R8, Arduino-ESP32 core 3.x)
// Arduino IDE: Board "ESP32S3 Dev Module", Flash 16MB, PSRAM "OPI PSRAM",
// Partition "16M Flash (3MB APP/9.9MB FATFS)", USB CDC On Boot "Enabled".
// Library: GFX Library for Arduino, PubSubClient, Chirale_TensorFlowLite (atau TensorFlowLite_ESP32).
//
// Alur (sesuai proposal): kamera -> Haar -> MobileNetV3 -> (anomali bertahan 3 detik)
// -> rekam suara -> MFCC -> CNN -> jika keduanya positif: layar peringatan + notifikasi MQTT ke dasbor.

#include "config.h"
#include "ui.h"
#include "net.h"
#include "vision.h"
#include "audio.h"

// Forward declaration fungsi fatal dengan atribut [[noreturn]] (Solusi 1)
// Mencegah error 'declared [[noreturn]] but its first declaration was not' dari auto-prototype Arduino IDE
[[noreturn]] static void fatal(const char* l1, const char* l2 = nullptr);

SET_LOOP_TASK_STACK_SIZE(16 * 1024);

enum State { ST_MONITOR, ST_AUDIO, ST_ALARM };
static State state = ST_MONITOR;

static uint32_t posSince = 0, cooldownUntil = 0, audioRetryAt = 0;
static int posCount = 0;
static bool audioOk = false;     // false: model suara gagal dimuat, alarm ditahan (mode uji visual)
static float faceSum = 0, lastFace = 0, lastDys = 0;

[[noreturn]] static void fatal(const char* l1, const char* l2) {
  uiMessage(l1, l2, COL_RED, "Restart 5 dtk");
  delay(5000);
  ESP.restart();
  for (;;) delay(1000);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  uiInit();
  uiMessage("AXIONIS", "Memulai...");
  if (!psramFound()) fatal("PSRAM mati", "Pilih OPI PSRAM");
  if (!visionInit()) fatal("Kamera/model", "gambar gagal");
  audioOk = audioInit();
  if (!audioOk) { uiMessage("Suara nonaktif", "Cek model suara", COL_RED, "Lihat log serial"); delay(2500); }
  netStart();
  uiMessage("AXIONIS\n siaga", "Hadapkan wajah", COL_BLACK);
  delay(800);
}

static void monitorStep() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { delay(5); return; }

  const uint32_t now = millis();

  // Simpan hasil deteksi terakhir di memori agar tidak perlu hitung AI di setiap frame
  static FaceResult fr = {}; 
  static uint32_t lastAiMs = 0;

  // Jalankan AI (visionProcess) setiap 250ms (~4x per detik) agar kamera tidak lag
  if (now - lastAiMs >= 250) {
    lastAiMs = now;
    fr = visionProcess(fb);

    Serial.printf("[face] found=%d p=%.2f detect=%lums infer=%lums\n",
                  fr.found, fr.pStroke,
                  (unsigned long)fr.msDetect, (unsigned long)fr.msInfer);

    if (fr.valid && fr.pStroke >= FACE_STROKE_THRESH) {
      if (posCount == 0) { posSince = now; faceSum = 0; }
      posCount++;
      faceSum += fr.pStroke;
      if (posCount >= FACE_MIN_POSITIVE && now - posSince >= FACE_HOLD_MS &&
          now >= cooldownUntil && now >= audioRetryAt) {
        lastFace = faceSum / posCount;
        state = ST_AUDIO;
      }
    } else {
      posCount = 0;
    }
  }

  // Siapkan teks & warna indikator dari hasil AI terakhir
  char footer[32];
  uint16_t col = COL_BLUE;
  if (!fr.found) {
    snprintf(footer, sizeof(footer), "Hadapkan wajah");
  } else if (!fr.valid) {
    snprintf(footer, sizeof(footer), "Analisis gagal");
    col = COL_YELLOW;
  } else if (fr.pStroke >= FACE_STROKE_THRESH) {
    snprintf(footer, sizeof(footer), "Waspada %d%%", (int)(fr.pStroke * 100));
    col = COL_RED;
  } else {
    snprintf(footer, sizeof(footer), "Normal %d%%", (int)((1.0f - fr.pStroke) * 100));
    col = COL_GREEN;
  }

  if (now < cooldownUntil) {
    snprintf(footer, sizeof(footer), "Peringatan terkirim");
    col = COL_BLUE;
  }

  // Update layar & kirim frame kamera ke MQTT berjalan mulus tanpa tertahan AI
  uiPreview(fb->buf, fb->width, fb->height, fr.found ? &fr.box : nullptr, footer, col);
  netUpdateCamera(fb, fr.pStroke, fr.found);
  esp_camera_fb_return(fb);
}

static void audioStep() {
  if (!audioOk) {
    uiMessage("Suara nonaktif", "Alarm ditahan", COL_RED);
    posCount = 0; audioRetryAt = millis() + AUDIO_RETRY_MS; delay(1200);
    state = ST_MONITOR;
    return;
  }
  uiMessage("Ucapkan kalimat", "Rekam 2 detik", COL_BLUE, "Bersiap...");
  delay(AUDIO_PROMPT_MS);
  uiMessage("MEREKAM", "Bicara sekarang", COL_BLUE);
  const float rms = audioRecord();
  uiMessage("Menganalisis", "Mohon tunggu", COL_BLUE);
  const AudioResult ar = audioClassify(rms);
  Serial.printf("[audio] valid=%d p=%.2f\n", ar.valid, ar.pDys);

  posCount = 0;
  if (!ar.valid) {
    uiMessage("Suara tidak jelas", "Mengulang...", COL_BLACK);
    audioRetryAt = millis() + 5000;
    delay(1200);
    state = ST_MONITOR;
  } else if (ar.pDys >= AUDIO_DYS_THRESH) {
    lastDys = ar.pDys;
    state = ST_ALARM;
  } else {
    uiMessage("Suara normal", "Pemantauan lanjut", COL_GREEN);
    audioRetryAt = millis() + AUDIO_RETRY_MS;
    delay(1200);
    state = ST_MONITOR;
  }
}

static void alarmStep() {
  netSendAlert(lastFace, lastDys);               // alarm lokal tampil dulu, kirim tidak memblokir
  const uint32_t start = millis();
  int shown = -1;
  while (millis() - start < ALARM_MS) {
    const int st = gAlertState;
    if (st != shown) {
      shown = st;
      const char* s = st == AL_SENT ? "Dasbor: terkirim" : st == AL_FAILED ? "Dasbor: gagal kirim"
                    : (gWifiUp ? "Dasbor: mengirim..." : "Dasbor: offline");
      uiMessage("STROKE!", "Hubungi 119/IGD", COL_RED, s);
    }
    delay(250);
  }
  cooldownUntil = millis() + COOLDOWN_MS;
  posCount = 0;
  state = ST_MONITOR;
}

void loop() {
  switch (state) {
    case ST_MONITOR: monitorStep(); break;
    case ST_AUDIO:   audioStep();   break;
    case ST_ALARM:   alarmStep();   break;
  }
}