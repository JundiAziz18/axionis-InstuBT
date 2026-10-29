#pragma once
// Kamera -> Haar (lokalisasi wajah) -> crop -> MobileNetV3 INT8 (facial droop).
#include "esp_camera.h"
#include "config.h"
#include "haar.h"
#include "tflm_runner.h"
#include "face_model.h"

static const int DET_W = 160, DET_H = 120;     // gambar abu-abu untuk Haar (QVGA/2)
static haar::Detector haarDet;
static uint8_t* grayBuf = nullptr;
static TflmRunner faceNet;

struct FaceResult {
  bool found = false;
  bool valid = false;        // probabilitas stroke valid
  haar::Box box = {0, 0, 0, 0, 0};   // koordinat pada frame penuh (QVGA)
  float pStroke = 0;
  uint32_t msDetect = 0, msInfer = 0;
};

inline void rgb565be(const uint8_t* p, int& r, int& g, int& b) {
  const uint16_t v = ((uint16_t)p[0] << 8) | p[1];
  r = (v >> 11) & 0x1F; r = (r << 3) | (r >> 2);
  g = (v >> 5) & 0x3F;  g = (g << 2) | (g >> 4);
  b = v & 0x1F;         b = (b << 3) | (b >> 2);
}

inline bool visionInit() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_pwdn = CAM_PWDN; c.pin_reset = CAM_RESET; c.pin_xclk = CAM_XCLK;
  c.pin_sccb_sda = CAM_SIOD; c.pin_sccb_scl = CAM_SIOC;
  c.pin_d0 = CAM_D0; c.pin_d1 = CAM_D1; c.pin_d2 = CAM_D2; c.pin_d3 = CAM_D3;
  c.pin_d4 = CAM_D4; c.pin_d5 = CAM_D5; c.pin_d6 = CAM_D6; c.pin_d7 = CAM_D7;
  c.pin_vsync = CAM_VSYNC; c.pin_href = CAM_HREF; c.pin_pclk = CAM_PCLK;
  c.xclk_freq_hz = CAM_XCLK_HZ;
  c.pixel_format = PIXFORMAT_RGB565;
  c.frame_size = FRAMESIZE_QVGA;               // 320x240
  c.jpeg_quality = 12;
  c.fb_count = 2;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  const esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { Serial.printf("[cam] init gagal 0x%x\n", (unsigned)err); return false; }
  sensor_t* s = esp_camera_sensor_get();
  if (s) { s->set_vflip(s, CAM_VFLIP); s->set_hmirror(s, CAM_HMIRROR); }
  for (int i = 0; i < 3; i++) { camera_fb_t* f = esp_camera_fb_get(); if (f) esp_camera_fb_return(f); }

  grayBuf = (uint8_t*)heap_caps_malloc(DET_W * DET_H, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!grayBuf || !haarDet.init(DET_W, DET_H)) { Serial.println("[haar] alokasi gagal"); return false; }
  if (!faceNet.begin("face", face_model, FACE_ARENA_BYTES)) return false;
  TfLiteTensor* in = faceNet.input();
  if (in->dims->size != 4 || in->dims->data[3] != 3) { Serial.println("[face] bentuk input tidak terduga"); return false; }
  return true;
}

// Frame 320x240 -> abu-abu 160x120 (rata-rata blok 2x2).
inline void makeGray(const camera_fb_t* fb) {
  for (int y = 0; y < DET_H; y++) {
    for (int x = 0; x < DET_W; x++) {
      int acc = 0;
      for (int dy = 0; dy < 2; dy++)
        for (int dx = 0; dx < 2; dx++) {
          int r, g, b;
          rgb565be(fb->buf + ((size_t)(2 * y + dy) * fb->width + (2 * x + dx)) * 2, r, g, b);
          acc += (77 * r + 150 * g + 29 * b) >> 8;
        }
      grayBuf[y * DET_W + x] = (uint8_t)(acc >> 2);
    }
  }
}

// Crop persegi di sekitar kotak wajah, resample bilinear ke tensor input (256x256x3).
// Model sudah berisi preprocessing, jadi piksel mentah 0..255 (int8: piksel - 128).
inline bool fillFaceInput(const camera_fb_t* fb, const haar::Box& b) {
  TfLiteTensor* in = faceNet.input();
  const int OH = in->dims->data[1], OW = in->dims->data[2];
  const int FW = fb->width, FH = fb->height;
  float side = (float)(b.w > b.h ? b.w : b.h) * (1.0f + 2.0f * FACE_CROP_MARGIN);
  const float maxSide = (float)(FW < FH ? FW : FH);
  if (side > maxSide) side = maxSide;
  float x0 = b.x + b.w * 0.5f - side * 0.5f, y0 = b.y + b.h * 0.5f - side * 0.5f;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + side > FW) x0 = FW - side;
  if (y0 + side > FH) y0 = FH - side;
  const float stepX = side / OW, stepY = side / OH;
  const bool isInt8 = in->type == kTfLiteInt8;
  const float invS = isInt8 ? 1.0f / in->params.scale : 1.0f;
  const int zp = isInt8 ? in->params.zero_point : 0;
  for (int oy = 0; oy < OH; oy++) {
    float sy = y0 + (oy + 0.5f) * stepY - 0.5f;
    if (sy < 0) sy = 0;
    int iy = (int)sy; if (iy > FH - 2) iy = FH - 2;
    const float fy = sy - iy;
    for (int ox = 0; ox < OW; ox++) {
      float sx = x0 + (ox + 0.5f) * stepX - 0.5f;
      if (sx < 0) sx = 0;
      int ix = (int)sx; if (ix > FW - 2) ix = FW - 2;
      const float fx = sx - ix;
      int r[4], g[4], bl[4];
      const uint8_t* p = fb->buf + ((size_t)iy * FW + ix) * 2;
      rgb565be(p, r[0], g[0], bl[0]);
      rgb565be(p + 2, r[1], g[1], bl[1]);
      rgb565be(p + (size_t)FW * 2, r[2], g[2], bl[2]);
      rgb565be(p + (size_t)FW * 2 + 2, r[3], g[3], bl[3]);
      const float w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      const float v[3] = {
        r[0] * w00 + r[1] * w01 + r[2] * w10 + r[3] * w11,
        g[0] * w00 + g[1] * w01 + g[2] * w10 + g[3] * w11,
        bl[0] * w00 + bl[1] * w01 + bl[2] * w10 + bl[3] * w11};
      const size_t base = ((size_t)oy * OW + ox) * 3;
      for (int k = 0; k < 3; k++) {
        if (isInt8) {
          int q = (int)lroundf(v[k] * invS) + zp;
          in->data.int8[base + k] = (int8_t)(q < -128 ? -128 : (q > 127 ? 127 : q));
        } else {
          in->data.f[base + k] = v[k];
        }
      }
    }
  }
  return true;
}

inline FaceResult visionProcess(const camera_fb_t* fb) {
  FaceResult r;
  uint32_t t0 = millis();
  makeGray(fb);
  haar::Box boxes[4];
  const int n = haarDet.detect(grayBuf, DET_W, DET_H, HAAR_MIN_SIZE, HAAR_SCALE, HAAR_MIN_NEIGHBORS, boxes, 4);
  r.msDetect = millis() - t0;
  if (n == 0) return r;
  r.found = true;
  r.box = {boxes[0].x * 2, boxes[0].y * 2, boxes[0].w * 2, boxes[0].h * 2, boxes[0].n};
  t0 = millis();
  if (fillFaceInput(fb, r.box) && faceNet.run()) {
    r.pStroke = faceNet.prob(FACE_IDX_STROKE);
    r.valid = true;
  }
  r.msInfer = millis() - t0;
  return r;
}
