#pragma once
// INMP441 (I2S) -> float [-1,1] -> MFCC (identik librosa) -> CNN ringan (disartria).
#include <ESP_I2S.h>
#include "config.h"
#include "mfcc.h"
#include "tflm_runner.h"
#include "audio_model.h"

static I2SClass i2s;
static float* pcm = nullptr;
static mfcc::Ctx mfccCtx;
static TflmRunner audioNet;
static float* mfccTmp = nullptr;   // MFCC float sementara (63 x 40) sebelum dikuantisasi
static const size_t PCM_SAMPLES = (size_t)AUDIO_SAMPLE_RATE * AUDIO_SECONDS;

struct AudioResult {
  bool valid = false;     // false jika diam atau gagal
  float pDys = 0;
  float rms = 0;
};

inline bool audioInit() {
  pcm = (float*)heap_caps_malloc(PCM_SAMPLES * sizeof(float), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!pcm) { Serial.println("[audio] alokasi buffer gagal"); return false; }
  if (!mfcc::init(mfccCtx)) { Serial.println("[audio] init MFCC gagal"); return false; }
  i2s.setPins(PIN_I2S_SCK, PIN_I2S_WS, -1, PIN_I2S_SD, -1);
  if (!i2s.begin(I2S_MODE_STD, AUDIO_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT,
                 I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.println("[audio] I2S gagal"); return false;
  }
  if (!audioNet.begin("audio", audio_model, AUDIO_ARENA_BYTES)) return false;
  TfLiteTensor* in = audioNet.input();
  const bool typeOk = in->type == kTfLiteFloat32 || in->type == kTfLiteInt8;
  if (!typeOk || in->dims->size != 4 || in->dims->data[1] != mfcc::numFrames((int)PCM_SAMPLES) ||
      in->dims->data[2] != mfcc::NMFCC) {
    Serial.printf("[audio] input model tidak cocok: type=%d, harus float32 atau int8 dengan bentuk [1,63,40,1]\n", (int)in->type);
    return false;
  }
  mfccTmp = (float*)heap_caps_malloc((size_t)in->dims->data[1] * mfcc::NMFCC * sizeof(float), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!mfccTmp) { Serial.println("[audio] alokasi MFCC gagal"); return false; }
  Serial.printf("[audio] model %s siap\n", in->type == kTfLiteInt8 ? "INT8" : "float32");
  return true;
}

// Rekam AUDIO_SECONDS detik, buang data lama dulu, hilangkan offset DC. Mengembalikan RMS.
inline float audioRecord() {
  static int32_t tmp[256];
  const size_t flush = AUDIO_SAMPLE_RATE / 4;            // buang 250 ms data DMA lama
  for (size_t got = 0; got < flush;) got += i2s.readBytes((char*)tmp, sizeof(tmp)) / 4;
  size_t got = 0;
  double sum = 0;
  while (got < PCM_SAMPLES) {
    const size_t want = min((size_t)256, PCM_SAMPLES - got);
    const size_t n = i2s.readBytes((char*)tmp, want * 4) / 4;
    for (size_t i = 0; i < n; i++) {
      const float v = (float)tmp[i] / 2147483648.0f;      // 24-bit rata kiri di slot 32-bit
      pcm[got + i] = v;
      sum += v;
    }
    got += n;
  }
  const float mean = (float)(sum / PCM_SAMPLES);
  double sq = 0;
  for (size_t i = 0; i < PCM_SAMPLES; i++) {
    const float v = constrain((pcm[i] - mean) * AUDIO_GAIN, -1.0f, 1.0f);
    pcm[i] = v;
    sq += (double)v * v;
  }
  return (float)sqrt(sq / PCM_SAMPLES);
}

inline AudioResult audioClassify(float rms) {
  AudioResult r;
  r.rms = rms;
  Serial.printf("[audio] RMS=%.4f (bandingkan dengan RMS data training)\n", rms);
  if (rms < AUDIO_MIN_RMS) return r;                      // diam: jangan diklasifikasi
  TfLiteTensor* in = audioNet.input();
  const int F = mfcc::compute(mfccCtx, pcm, (int)PCM_SAMPLES, mfccTmp);
  if (F != in->dims->data[1]) return r;
  const int n = F * mfcc::NMFCC;
  if (in->type == kTfLiteFloat32) {
    memcpy(in->data.f, mfccTmp, (size_t)n * sizeof(float));
  } else {                                           // INT8: q = round(x / S) + Z
    const float inv = 1.0f / in->params.scale;
    const int zp = in->params.zero_point;
    int sat = 0;
    for (int i = 0; i < n; i++) {
      int q = (int)lroundf(mfccTmp[i] * inv) + zp;
      if (q < -128) { q = -128; sat++; } else if (q > 127) { q = 127; sat++; }
      in->data.int8[i] = (int8_t)q;
    }
    Serial.printf("[audio] kuantisasi INT8: scale=%.5f zp=%d, saturasi %d dari %d nilai\n", in->params.scale, zp, sat, n);
  }
  if (!audioNet.run()) return r;
  r.pDys = audioNet.prob(0);                              // sigmoid tunggal
  r.valid = true;
  return r;
}
