#pragma once
// Detektor wajah Haar cascade (Viola-Jones) untuk ESP32, hanya butuh libc.
// Perilaku mengikuti OpenCV detectMultiScale (cascade frontalface_default):
// fitur diskalakan di atas integral image, normalisasi varians, grouping tetangga.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "haar_data.h"

#ifdef ARDUINO
#include "esp_heap_caps.h"
#define HAAR_ALLOC(n) heap_caps_malloc((n), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)
#else
#define HAAR_ALLOC(n) malloc(n)
#endif

namespace haar {

struct Box { int x, y, w, h, n; };   // n = jumlah deteksi yang digabung

class Detector {
 public:
  ~Detector() { free(sum_); free(sq_); free(off_); free(w0_); }

  // maxW/maxH: ukuran gambar abu-abu terbesar yang akan diproses
  bool init(int maxW, int maxH) {
    maxW_ = maxW; maxH_ = maxH;
    size_t cells = (size_t)(maxW + 1) * (maxH + 1);
    sum_ = (uint32_t*)HAAR_ALLOC(cells * 4);
    sq_  = (uint32_t*)HAAR_ALLOC(cells * 4);
    off_ = (int32_t*)HAAR_ALLOC((size_t)haar_data::N_FEAT * 12 * 4);
    w0_  = (float*)HAAR_ALLOC((size_t)haar_data::N_FEAT * 4);
    return sum_ && sq_ && off_ && w0_;
  }

  // gray: w*h uint8. minSize: lebar wajah minimum (piksel). Mengembalikan jumlah kotak
  // hasil grouping (terurut dari terbesar) dan menulisnya ke out.
  int detect(const uint8_t* gray, int w, int h, int minSize, float scaleFactor,
             int minNeighbors, Box* out, int maxOut) {
    if (!sum_ || w > maxW_ || h > maxH_) return 0;
    buildIntegral(gray, w, h);
    nRaw_ = 0;
    const int stride = w + 1;
    for (float s = (float)minSize / haar_data::WIN; haar_data::WIN * s <= (float)(w < h ? w : h);
         s *= scaleFactor) {
      const int ws = (int)lroundf(haar_data::WIN * s);
      if (ws > w || ws > h) break;
      buildOffsets(s, stride);
      // persegi normalisasi: (1,1)-(23,23) pada jendela dasar
      const int nx0 = (int)lroundf(1 * s), nx1 = (int)lroundf(23 * s);
      const int ny0 = nx0, ny1 = nx1;
      const int area = (nx1 - nx0) * (ny1 - ny0);
      const int offN[4] = {ny0 * stride + nx0, ny0 * stride + nx1, ny1 * stride + nx0, ny1 * stride + nx1};
      int step = (int)lroundf(s * (s > 2.0f ? 1.0f : 2.0f));
      if (step < 1) step = 1;
      for (int y = 0; y + ws <= h; y += step) {
        for (int x = 0; x + ws <= w; x += step) {
          const int o = y * stride + x;
          if (evalWindow(o, offN, area)) {
            if (nRaw_ < MAX_RAW) raw_[nRaw_++] = {x, y, ws, ws, 1};
          }
        }
      }
    }
    return group(minNeighbors, out, maxOut);
  }

 private:
  static constexpr int MAX_RAW = 400;
  int maxW_ = 0, maxH_ = 0;
  uint32_t *sum_ = nullptr, *sq_ = nullptr;
  int32_t* off_ = nullptr;   // [fitur][3 persegi][tl,tr,bl,br]
  float* w0_ = nullptr;      // bobot persegi pertama per skala
  Box raw_[MAX_RAW];
  int nRaw_ = 0;

  void buildIntegral(const uint8_t* g, int w, int h) {
    const int st = w + 1;
    memset(sum_, 0, st * 4); memset(sq_, 0, st * 4);
    for (int y = 0; y < h; y++) {
      uint32_t rs = 0, rq = 0;
      sum_[(y + 1) * st] = 0; sq_[(y + 1) * st] = 0;
      for (int x = 0; x < w; x++) {
        uint32_t v = g[y * w + x];
        rs += v; rq += v * v;
        sum_[(y + 1) * st + x + 1] = sum_[y * st + x + 1] + rs;
        sq_[(y + 1) * st + x + 1] = sq_[y * st + x + 1] + rq;
      }
    }
  }

  void buildOffsets(float s, int stride) {
    for (int f = 0; f < haar_data::N_FEAT; f++) {
      const int8_t* F = haar_data::FEAT[f];
      int32_t* o = off_ + f * 12;
      int area[3] = {0, 0, 0};
      for (int r = 0; r < 3; r++) {
        const int x = F[r * 5], y = F[r * 5 + 1], rw = F[r * 5 + 2], rh = F[r * 5 + 3];
        if (rw == 0 || rh == 0) { o[r * 4] = o[r * 4 + 1] = o[r * 4 + 2] = o[r * 4 + 3] = 0; continue; }
        const int x0 = (int)lroundf(x * s), x1 = (int)lroundf((x + rw) * s);
        const int y0 = (int)lroundf(y * s), y1 = (int)lroundf((y + rh) * s);
        o[r * 4]     = y0 * stride + x0;   // tl
        o[r * 4 + 1] = y0 * stride + x1;   // tr
        o[r * 4 + 2] = y1 * stride + x0;   // bl
        o[r * 4 + 3] = y1 * stride + x1;   // br
        area[r] = (x1 - x0) * (y1 - y0);
      }
      // jumlah bobot x luas = 0 harus tetap berlaku setelah pembulatan
      float sum0 = (float)F[9] * area[1] + (float)F[14] * area[2];
      w0_[f] = area[0] > 0 ? -sum0 / area[0] : 0.0f;
    }
  }

  bool evalWindow(int o, const int* offN, int area) {
    const uint32_t* S = sum_ + o;
    const uint32_t* Q = sq_ + o;
    const double vs = (double)(int32_t)(S[offN[3]] - S[offN[1]] - S[offN[2]] + S[offN[0]]);
    const double vq = (double)(uint32_t)(Q[offN[3]] - Q[offN[1]] - Q[offN[2]] + Q[offN[0]]);
    double nf = (double)area * vq - vs * vs;
    if (nf <= 0.0) return false;
    nf = sqrt(nf);
    if ((double)area / nf >= 0.1) return false;      // kontras terlalu rendah (sigma <= 10)
    const float inv = (float)(1.0 / nf);
    int si = 0;
    for (int st = 0; st < haar_data::N_STAGE; st++) {
      float acc = 0.0f;
      const int n = haar_data::STAGE[st].n;
      for (int k = 0; k < n; k++, si++) {
        const haar_data::Stump& sp = haar_data::STUMP[si];
        const int8_t* F = haar_data::FEAT[sp.f];
        const int32_t* of = off_ + sp.f * 12;
        float v = 0.0f;
        for (int r = 0; r < 3; r++) {
          const float wt = (r == 0) ? w0_[sp.f] : (float)F[r * 5 + 4];
          if (wt == 0.0f) continue;
          int32_t rect = (int32_t)(S[of[r * 4 + 3]] - S[of[r * 4 + 1]] - S[of[r * 4 + 2]] + S[of[r * 4]]);
          v += wt * (float)rect;
        }
        acc += (v * inv < sp.thr) ? sp.l0 : sp.l1;
      }
      if (acc < haar_data::STAGE[st].thr) return false;
    }
    return true;
  }

  static bool similar(const Box& a, const Box& b) {
    const float d = 0.2f * 0.5f * ((a.w < b.w ? a.w : b.w) + (a.h < b.h ? a.h : b.h));
    return fabsf((float)(a.x - b.x)) <= d && fabsf((float)(a.y - b.y)) <= d &&
           fabsf((float)(a.x + a.w - b.x - b.w)) <= d && fabsf((float)(a.y + a.h - b.y - b.h)) <= d;
  }

  int group(int minNeighbors, Box* out, int maxOut) {
    static int lab[MAX_RAW];
    int nc = 0;
    for (int i = 0; i < nRaw_; i++) lab[i] = -1;
    for (int i = 0; i < nRaw_; i++) {
      if (lab[i] < 0) lab[i] = nc++;
      for (int j = i + 1; j < nRaw_; j++)
        if (similar(raw_[i], raw_[j])) {
          if (lab[j] < 0) lab[j] = lab[i];
          else if (lab[j] != lab[i]) { int old = lab[j]; for (int k = 0; k < nRaw_; k++) if (lab[k] == old) lab[k] = lab[i]; }
        }
    }
    int nOut = 0;
    for (int c = 0; c < nc; c++) {
      long sx = 0, sy = 0, sw = 0, sh = 0; int n = 0;
      for (int i = 0; i < nRaw_; i++) if (lab[i] == c) { sx += raw_[i].x; sy += raw_[i].y; sw += raw_[i].w; sh += raw_[i].h; n++; }
      if (n > minNeighbors && nOut < maxOut) out[nOut++] = {(int)(sx / n), (int)(sy / n), (int)(sw / n), (int)(sh / n), n};
    }
    for (int i = 1; i < nOut; i++) {   // urut menurun berdasarkan luas
      Box b = out[i]; int j = i - 1;
      while (j >= 0 && out[j].w * out[j].h < b.w * b.h) { out[j + 1] = out[j]; j--; }
      out[j + 1] = b;
    }
    return nOut;
  }
};

}  // namespace haar
