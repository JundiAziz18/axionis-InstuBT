#pragma once
// Port librosa.feature.mfcc(y, sr=16000, n_mfcc=40) dengan parameter default librosa:
// n_fft=2048, hop=512, n_mels=128 (Slaney), hann periodik, power=2, power_to_db(top_db=80),
// DCT-II ortho. Input: float [-1,1]. Output: [frames][40] (setara mfcc.T pada training).
// Murni C++ (math.h), bisa diuji di PC dan jalan di ESP32.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef MFCC_PAD_REFLECT
#define MFCC_PAD_REFLECT 0   // 0 = pad nol (librosa >= 0.10), 1 = reflect (librosa lama)
#endif

namespace mfcc {

constexpr int   SR = 16000, NFFT = 2048, HOP = 512, NMELS = 128, NMFCC = 40;
constexpr float TOP_DB = 80.0f, AMIN = 1e-10f;

struct Ctx {
  bool  ready = false;
  float win[NFFT];
  float cosT[NFFT / 2], sinT[NFFT / 2];
  float dct[NMFCC][NMELS];
  int   mStart[NMELS], mLen[NMELS], mOff[NMELS];
  float* mW = nullptr;   // bobot mel sparse
};

inline double hz2mel(double f) {            // Slaney
  const double f_sp = 200.0 / 3.0, min_log_hz = 1000.0;
  const double min_log_mel = min_log_hz / f_sp, logstep = log(6.4) / 27.0;
  return f >= min_log_hz ? min_log_mel + log(f / min_log_hz) / logstep : f / f_sp;
}
inline double mel2hz(double m) {
  const double f_sp = 200.0 / 3.0, min_log_hz = 1000.0;
  const double min_log_mel = min_log_hz / f_sp, logstep = log(6.4) / 27.0;
  return m >= min_log_mel ? min_log_hz * exp(logstep * (m - min_log_mel)) : f_sp * m;
}

inline bool init(Ctx& c) {
  if (c.ready) return true;
  for (int i = 0; i < NFFT; i++) c.win[i] = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * i / NFFT);
  for (int i = 0; i < NFFT / 2; i++) {
    c.cosT[i] = cosf(2.0f * (float)M_PI * i / NFFT);
    c.sinT[i] = -sinf(2.0f * (float)M_PI * i / NFFT);
  }
  // DCT-II ortho
  for (int k = 0; k < NMFCC; k++) {
    double s = (k == 0) ? sqrt(1.0 / NMELS) : sqrt(2.0 / NMELS);
    for (int n = 0; n < NMELS; n++) c.dct[k][n] = (float)(s * cos(M_PI * (n + 0.5) * k / NMELS));
  }
  // Filterbank mel Slaney (sparse)
  double melF[NMELS + 2];
  double mmin = hz2mel(0.0), mmax = hz2mel(SR / 2.0);
  for (int i = 0; i < NMELS + 2; i++) melF[i] = mel2hz(mmin + (mmax - mmin) * i / (NMELS + 1));
  const int NB = NFFT / 2 + 1;
  int total = 0;
  for (int m = 0; m < NMELS; m++) {
    int first = -1, last = -1;
    for (int k = 0; k < NB; k++) {
      double f = (double)k * SR / NFFT;
      double lo = (f - melF[m]) / (melF[m + 1] - melF[m]);
      double up = (melF[m + 2] - f) / (melF[m + 2] - melF[m + 1]);
      if (fmin(lo, up) > 0) { if (first < 0) first = k; last = k; }
    }
    c.mStart[m] = first < 0 ? 0 : first;
    c.mLen[m] = first < 0 ? 0 : last - first + 1;
    c.mOff[m] = total;
    total += c.mLen[m];
  }
  c.mW = (float*)malloc(sizeof(float) * total);
  if (!c.mW) return false;
  for (int m = 0; m < NMELS; m++) {
    double enorm = 2.0 / (melF[m + 2] - melF[m]);
    for (int j = 0; j < c.mLen[m]; j++) {
      int k = c.mStart[m] + j;
      double f = (double)k * SR / NFFT;
      double lo = (f - melF[m]) / (melF[m + 1] - melF[m]);
      double up = (melF[m + 2] - f) / (melF[m + 2] - melF[m + 1]);
      c.mW[c.mOff[m] + j] = (float)(fmax(0.0, fmin(lo, up)) * enorm);
    }
  }
  c.ready = true;
  return true;
}

inline void fft(const Ctx& c, float* re, float* im) {
  for (int i = 1, j = 0; i < NFFT; i++) {          // bit reversal
    int bit = NFFT >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { float t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int len = 2; len <= NFFT; len <<= 1) {
    int half = len >> 1, step = NFFT / len;
    for (int i = 0; i < NFFT; i += len) {
      for (int k = 0; k < half; k++) {
        float wr = c.cosT[k * step], wi = c.sinT[k * step];
        int a = i + k, b = a + half;
        float xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr;        im[a] += xi;
      }
    }
  }
}

inline int numFrames(int n) { return 1 + n / HOP; }

// x: n sampel float [-1,1]. out: numFrames(n) * NMFCC float. Return jumlah frame, -1 jika gagal.
inline int compute(const Ctx& c, const float* x, int n, float* out) {
  const int F = numFrames(n);
  float* db = (float*)malloc(sizeof(float) * F * NMELS);
  float* re = (float*)malloc(sizeof(float) * NFFT);
  float* im = (float*)malloc(sizeof(float) * NFFT);
  if (!db || !re || !im) { free(db); free(re); free(im); return -1; }
  float maxdb = -1e30f;
  for (int f = 0; f < F; f++) {
    int start = f * HOP - NFFT / 2;
    for (int i = 0; i < NFFT; i++) {
      int idx = start + i;
#if MFCC_PAD_REFLECT
      if (idx < 0) idx = -idx;
      if (idx >= n) idx = 2 * (n - 1) - idx;
      float s = (idx >= 0 && idx < n) ? x[idx] : 0.0f;
#else
      float s = (idx >= 0 && idx < n) ? x[idx] : 0.0f;
#endif
      re[i] = s * c.win[i]; im[i] = 0.0f;
    }
    fft(c, re, im);
    for (int m = 0; m < NMELS; m++) {
      float acc = 0.0f;
      const float* w = c.mW + c.mOff[m];
      for (int j = 0; j < c.mLen[m]; j++) {
        int k = c.mStart[m] + j;
        acc += w[j] * (re[k] * re[k] + im[k] * im[k]);
      }
      float v = 10.0f * log10f(acc > AMIN ? acc : AMIN);
      db[f * NMELS + m] = v;
      if (v > maxdb) maxdb = v;
    }
  }
  float floorDb = maxdb - TOP_DB;
  for (int f = 0; f < F; f++) {
    float* row = db + f * NMELS;
    for (int m = 0; m < NMELS; m++) if (row[m] < floorDb) row[m] = floorDb;
    for (int k = 0; k < NMFCC; k++) {
      float s = 0.0f;
      for (int m = 0; m < NMELS; m++) s += c.dct[k][m] * row[m];
      out[f * NMFCC + k] = s;
    }
  }
  free(db); free(re); free(im);
  return F;
}

}  // namespace mfcc
