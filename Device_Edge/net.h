// #pragma once
// // Wi-Fi + NTP + MQTT di core 0. Tidak pernah memblokir inferensi di core 1.
// // Kontrak dashboard (JSON, UTF-8):
// //   axionis/<id>/alert  {"device","level":"critical","ts"(epoch UTC, 0 jika NTP belum sinkron),
// //                        "uptime_ms","face","dys","msg","id"}  id unik per kejadian (bootid-urut): dasbor
// //                        membuang duplikat berdasarkan id (publish QoS 0, bisa terkirim ulang)
// //   axionis/<id>/status {"device","online","rssi","ip","uptime_ms","fw"}  (retained, LWT online=false)
// #include <WiFi.h>
// #if MQTT_USE_TLS
// #include <WiFiClientSecure.h>
// #endif
// #include <PubSubClient.h>
// #include <time.h>
// #include <esp_random.h>
// #include "config.h"

// enum AlertState : uint8_t { AL_NONE = 0, AL_PENDING, AL_SENT, AL_FAILED };

// struct AlertMsg { uint32_t uptimeMs; int64_t epoch; float face; float dys; uint32_t seq; };

// static volatile uint8_t gAlertState = AL_NONE;
// static volatile bool gWifiUp = false, gMqttUp = false;
// static QueueHandle_t gAlertQ = nullptr;
// #if MQTT_USE_TLS
// static WiFiClientSecure netClient;
// #else
// static WiFiClient netClient;
// #endif
// static uint32_t gBootId = 0;
// #define MQTT_NEEDS_TIME (MQTT_USE_TLS && (sizeof(MQTT_CA_CERT) > 1))
// static PubSubClient mqtt(netClient);

// inline int64_t nowEpoch() {
//   const time_t t = time(nullptr);
//   return t > 1700000000 ? (int64_t)t : 0;      // 0 = belum sinkron NTP
// }

// static bool mqttConnect() {
//   const char* will = "{\"device\":\"" DEVICE_ID "\",\"online\":false}";
//   const bool useAuth = strlen(MQTT_USER) > 0;
//   return mqtt.connect(DEVICE_ID, useAuth ? MQTT_USER : nullptr, useAuth ? MQTT_PASS : nullptr,
//                       MQTT_TOPIC_STATUS, 1, true, will);
// }

// static bool publishStatus(bool online) {
//   char buf[192];
//   snprintf(buf, sizeof(buf),
//            "{\"device\":\"" DEVICE_ID "\",\"online\":%s,\"rssi\":%d,\"ip\":\"%s\",\"uptime_ms\":%lu,\"fw\":\"" FW_VERSION "\"}",
//            online ? "true" : "false", WiFi.RSSI(), WiFi.localIP().toString().c_str(), (unsigned long)millis());
//   return mqtt.publish(MQTT_TOPIC_STATUS, buf, true);
// }

// static bool publishAlert(const AlertMsg& a) {
//   char buf[320];
//   snprintf(buf, sizeof(buf),
//            "{\"device\":\"" DEVICE_ID "\",\"level\":\"critical\",\"ts\":%lld,\"uptime_ms\":%lu,"
//            "\"face\":%.3f,\"dys\":%.3f,\"msg\":\"Indikasi stroke: facial droop dan dysarthria\","
//            "\"id\":\"%08lx-%lu\"}",
//            (long long)a.epoch, (unsigned long)a.uptimeMs, a.face, a.dys,
//            (unsigned long)gBootId, (unsigned long)a.seq);
//   return mqtt.publish(MQTT_TOPIC_ALERT, buf, false);
// }

// static void netTask(void*) {
// #if MQTT_USE_TLS
//   if (sizeof(MQTT_CA_CERT) > 1) netClient.setCACert(MQTT_CA_CERT);
//   else netClient.setInsecure();   // terenkripsi tapi server tidak diverifikasi; isi MQTT_CA_CERT untuk produksi
// #endif
//   mqtt.setServer(MQTT_HOST, MQTT_PORT);
//   mqtt.setBufferSize(512);
//   mqtt.setKeepAlive(30);
//   WiFi.mode(WIFI_STA);
//   WiFi.setAutoReconnect(true);
//   WiFi.begin(WIFI_SSID, WIFI_PASS);

//   bool ntpStarted = false;
//   uint32_t lastStatus = 0, lastTry = 0, pendingSince = 0;
//   AlertMsg pending = {};
//   bool havePending = false;

//   for (;;) {
//     gWifiUp = WiFi.status() == WL_CONNECTED;
//     if (gWifiUp && !ntpStarted) { configTime(7 * 3600, 0, NTP_SERVER); ntpStarted = true; }   // WIB
//     if (gWifiUp && !mqtt.connected() && millis() - lastTry > 3000 && (!MQTT_NEEDS_TIME || nowEpoch() > 0)) {
//       lastTry = millis();
//       if (mqttConnect()) { publishStatus(true); lastStatus = millis(); }
//     }
//     gMqttUp = mqtt.connected();
//     if (gMqttUp) mqtt.loop();

//     if (!havePending && xQueueReceive(gAlertQ, &pending, 0) == pdTRUE) {
//       havePending = true; pendingSince = millis(); gAlertState = AL_PENDING;
//     }
//     if (havePending) {
//       if (gMqttUp && publishAlert(pending)) { havePending = false; gAlertState = AL_SENT; }
//       else if (millis() - pendingSince > ALERT_TIMEOUT_MS) { havePending = false; gAlertState = AL_FAILED; }
//     }
//     if (gMqttUp && millis() - lastStatus > STATUS_PERIOD_MS) { publishStatus(true); lastStatus = millis(); }
//     vTaskDelay(pdMS_TO_TICKS(100));
//   }
// }

// inline void netStart() {
//   gBootId = esp_random();
//   gAlertQ = xQueueCreate(4, sizeof(AlertMsg));
//   xTaskCreatePinnedToCore(netTask, "net", MQTT_USE_TLS ? 16384 : 8192, nullptr, 1, nullptr, 0);
// }

// // Dipanggil dari loop() saat alarm; segera kembali.
// inline void netSendAlert(float face, float dys) {
//   static uint32_t seq = 0;
//   AlertMsg m = {millis(), nowEpoch(), face, dys, ++seq};
//   gAlertState = AL_PENDING;
//   xQueueSend(gAlertQ, &m, 0);
// }


#pragma once
// Wi-Fi + NTP + MQTT (Status + Alert + Live Camera + Telemetry) di Core 0.
// Tidak pernah memblokir inferensi AI di Core 1.
#include <WiFi.h>
#if MQTT_USE_TLS
#include <WiFiClientSecure.h>
#endif
#include <PubSubClient.h>
#include <time.h>
#include <esp_random.h>
#include "esp_camera.h"
#include "img_converters.h"
#include <freertos/semphr.h>
#include "config.h"

// Topik tambahan otomatis mengikuti DEVICE_ID dari config.h
#ifndef MQTT_TOPIC_CAMERA
#define MQTT_TOPIC_CAMERA    "axionis/" DEVICE_ID "/camera"
#endif
#ifndef MQTT_TOPIC_TELEMETRY
#define MQTT_TOPIC_TELEMETRY "axionis/" DEVICE_ID "/telemetry"
#endif
#define CAM_MAX_JPG_BYTES 12288

enum AlertState : uint8_t { AL_NONE = 0, AL_PENDING, AL_SENT, AL_FAILED };

struct AlertMsg { uint32_t uptimeMs; int64_t epoch; float face; float dys; uint32_t seq; };

static volatile uint8_t gAlertState = AL_NONE;
static volatile bool gWifiUp = false, gMqttUp = false;
static QueueHandle_t gAlertQ = nullptr;

// Buffer bersama (Core 1 -> Core 0) untuk Frame JPEG Kamera & Skor Wajah
static SemaphoreHandle_t gCamMutex = nullptr;
static uint8_t* gCamJpgBuf = nullptr;
static size_t gCamJpgLen = 0;
static bool gCamFrameReady = false;
static float gLatestFaceProb = 0.0f;
static bool gLatestFaceFound = false;
static uint32_t gLastCamGrabMs = 0;

#if MQTT_USE_TLS
static WiFiClientSecure netClient;
#else
static WiFiClient netClient;
#endif
static uint32_t gBootId = 0;
#define MQTT_NEEDS_TIME (MQTT_USE_TLS && (sizeof(MQTT_CA_CERT) > 1))
static PubSubClient mqtt(netClient);

inline int64_t nowEpoch() {
  const time_t t = time(nullptr);
  return t > 1700000000 ? (int64_t)t : 0;      // 0 = belum sinkron NTP
}

static bool mqttConnect() {
  const char* will = "{\"device\":\"" DEVICE_ID "\",\"online\":false}";
  const bool useAuth = strlen(MQTT_USER) > 0;
  return mqtt.connect(DEVICE_ID, useAuth ? MQTT_USER : nullptr, useAuth ? MQTT_PASS : nullptr,
                      MQTT_TOPIC_STATUS, 1, true, will);
}

static bool publishStatus(bool online) {
  char buf[220];
  snprintf(buf, sizeof(buf),
           "{\"device\":\"" DEVICE_ID "\",\"online\":%s,\"rssi\":%d,\"ip\":\"%s\",\"uptime_ms\":%lu,\"free_psram\":%u,\"fw\":\"" FW_VERSION "\"}",
           online ? "true" : "false", WiFi.RSSI(), WiFi.localIP().toString().c_str(),
           (unsigned long)millis(), (unsigned int)ESP.getFreePsram());
  return mqtt.publish(MQTT_TOPIC_STATUS, buf, true);
}

static bool publishAlert(const AlertMsg& a) {
  char buf[320];
  snprintf(buf, sizeof(buf),
           "{\"device\":\"" DEVICE_ID "\",\"level\":\"critical\",\"ts\":%lld,\"uptime_ms\":%lu,"
           "\"face\":%.3f,\"dys\":%.3f,\"msg\":\"Indikasi stroke: facial droop dan dysarthria\","
           "\"id\":\"%08lx-%lu\"}",
           (long long)a.epoch, (unsigned long)a.uptimeMs, a.face, a.dys,
           (unsigned long)gBootId, (unsigned long)a.seq);
  return mqtt.publish(MQTT_TOPIC_ALERT, buf, false);
}

static bool publishTelemetry(float faceProb, bool faceFound) {
  char buf[160];
  snprintf(buf, sizeof(buf),
           "{\"device\":\"" DEVICE_ID "\",\"face\":%.3f,\"face_detected\":%s,\"state\":\"%s\"}",
           faceProb, faceFound ? "true" : "false",
           faceProb >= FACE_STROKE_THRESH ? "FACE_HOLD_3S" : "IDLE_SCANNING_FACE");
  return mqtt.publish(MQTT_TOPIC_TELEMETRY, buf, false);
}

static void netTask(void*) {
#if MQTT_USE_TLS
  if (sizeof(MQTT_CA_CERT) > 1) netClient.setCACert(MQTT_CA_CERT);
  else netClient.setInsecure();
  netClient.setNoDelay(true); 
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  // PENTING: Naikkan buffer ke 16 KB agar muat mengirim frame JPEG via MQTT EMQX
  mqtt.setBufferSize(CAM_MAX_JPG_BYTES);
  mqtt.setKeepAlive(30);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  bool ntpStarted = false;
  uint32_t lastStatus = 0, lastTry = 0, pendingSince = 0, lastCamPub = 0;
  AlertMsg pending = {};
  bool havePending = false;

  for (;;) {
    gWifiUp = WiFi.status() == WL_CONNECTED;
    if (gWifiUp && !ntpStarted) { configTime(7 * 3600, 0, NTP_SERVER); ntpStarted = true; }
    if (gWifiUp && !mqtt.connected() && millis() - lastTry > 3000 && (!MQTT_NEEDS_TIME || nowEpoch() > 0)) {
      lastTry = millis();
      if (mqttConnect()) { publishStatus(true); lastStatus = millis(); }
    }
    gMqttUp = mqtt.connected();
    if (gMqttUp) mqtt.loop();

    // 1. Prioritas Utama: Kirim Alert Darurat jika ada
    if (!havePending && xQueueReceive(gAlertQ, &pending, 0) == pdTRUE) {
      havePending = true; pendingSince = millis(); gAlertState = AL_PENDING;
    }
    if (havePending) {
      if (gMqttUp && publishAlert(pending)) { havePending = false; gAlertState = AL_SENT; }
      else if (millis() - pendingSince > ALERT_TIMEOUT_MS) { havePending = false; gAlertState = AL_FAILED; }
    }

    // 2. Kirim Frame Kamera JPEG Binary + Skor Wajah ke EMQX setiap ~500 ms
    if (gMqttUp && !havePending && gCamFrameReady && (millis() - lastCamPub > 450)) {
      if (xSemaphoreTake(gCamMutex, pdMS_TO_TICKS(15)) == pdTRUE) {
        if (gCamJpgBuf && gCamJpgLen > 0 && gCamJpgLen < 15500) {
          // Kirim Binary JPEG langsung ke axionis/<id>/camera (tanpa Base64, hemat RAM!)
          mqtt.publish(MQTT_TOPIC_CAMERA, gCamJpgBuf, gCamJpgLen, false);
          publishTelemetry(gLatestFaceProb, gLatestFaceFound);
          gCamFrameReady = false;
          lastCamPub = millis();
        }
        xSemaphoreGive(gCamMutex);
      }
    }

    // 3. Kirim Status Heartbeat berkala
    if (gMqttUp && millis() - lastStatus > STATUS_PERIOD_MS) {
      publishStatus(true);
      lastStatus = millis();
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

inline void netStart() {
  gBootId = esp_random();
  gAlertQ = xQueueCreate(4, sizeof(AlertMsg));
  gCamMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(netTask, "net", MQTT_USE_TLS ? 16384 : 10240, nullptr, 1, nullptr, 0);
}

// Dipanggil dari monitorStep() sebelum esp_camera_fb_return(fb)
inline void netUpdateCamera(camera_fb_t* fb, float faceProb, bool faceFound) {
  if (!fb || !gCamMutex || !gMqttUp) return;
  const uint32_t now = millis();
  if (now - gLastCamGrabMs < 500) return; // Ambil 2 frame per detik agar AI & MQTT tetap stabil
  gLastCamGrabMs = now;

  uint8_t* tmpJpg = nullptr;
  size_t tmpLen = 0;
  // Konversi RGB565 -> JPEG dengan kualitas 30 (ukuran ~3-5 KB, sangat ringan untuk MQTT)
  if (frame2jpg(fb, 30, &tmpJpg, &tmpLen)) {
    if (xSemaphoreTake(gCamMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
      if (gCamJpgBuf) free(gCamJpgBuf);
      gCamJpgBuf = tmpJpg;
      gCamJpgLen = tmpLen;
      gLatestFaceProb = faceProb;
      gLatestFaceFound = faceFound;
      gCamFrameReady = true;
      xSemaphoreGive(gCamMutex);
    } else {
      free(tmpJpg);
    }
  }

}

// Dipanggil dari loop() saat alarm; segera kembali.
inline void netSendAlert(float face, float dys) {
  static uint32_t seq = 0;
  AlertMsg m = {millis(), nowEpoch(), face, dys, ++seq};
  gAlertState = AL_PENDING;
  xQueueSend(gAlertQ, &m, 0);
}
