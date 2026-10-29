#pragma once
// Pembungkus TFLite Micro untuk dua model. Library yang didukung: Chirale_TensorFlowLite
// atau TensorFlowLite_ESP32 (set TFLM_LEGACY_API 1 di config.h untuk versi lama).
#include <Arduino.h>
#include "config.h"
#if __has_include(<Chirale_TensorFlowLite.h>)
  #include <Chirale_TensorFlowLite.h>
#elif __has_include(<TensorFlowLite_ESP32.h>)
  #include <TensorFlowLite_ESP32.h>
#endif
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"
#if TFLM_LEGACY_API
  #include "tensorflow/lite/micro/micro_error_reporter.h"
#endif
#include "esp_heap_caps.h"

// Operator yang dipakai kedua model (hasil inspeksi file .tflite):
// gambar: ADD CONV_2D DEPTHWISE_CONV_2D FULLY_CONNECTED HARD_SWISH MEAN MUL SOFTMAX
// suara : ADD CONV_2D DEPTHWISE_CONV_2D FULLY_CONNECTED LOGISTIC MAX_POOL_2D MEAN MUL
using AxResolver = tflite::MicroMutableOpResolver<12>;
inline AxResolver& axResolver() {
  static AxResolver r;
  static bool init = false;
  if (!init) {
    r.AddAdd(); r.AddConv2D(); r.AddDepthwiseConv2D(); r.AddFullyConnected();
    r.AddHardSwish(); r.AddLogistic(); r.AddMaxPool2D(); r.AddMean();
    r.AddMul(); r.AddSoftmax();
    r.AddQuantize(); r.AddDequantize();   // dipakai bila model INT8 masih punya input/output float
    init = true;
  }
  return r;
}

class TflmRunner {
 public:
  bool begin(const char* name, const unsigned char* modelData, size_t arenaBytes) {
    name_ = name;
    model_ = tflite::GetModel(modelData);
    if (model_->version() != TFLITE_SCHEMA_VERSION) {
      Serial.printf("[%s] versi schema model tidak cocok\n", name_);
      return false;
    }
    arena_ = (uint8_t*)heap_caps_malloc(arenaBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!arena_) { Serial.printf("[%s] alokasi arena gagal (PSRAM aktif?)\n", name_); return false; }
#if TFLM_LEGACY_API
    static tflite::MicroErrorReporter errReporter;
    interp_ = new tflite::MicroInterpreter(model_, axResolver(), arena_, arenaBytes, &errReporter);
#else
    interp_ = new tflite::MicroInterpreter(model_, axResolver(), arena_, arenaBytes);
#endif
    if (interp_->AllocateTensors() != kTfLiteOk) {
      Serial.printf("[%s] AllocateTensors gagal (arena kurang atau operator tidak didukung)\n", name_);
      return false;
    }
    in_ = interp_->input(0);
    out_ = interp_->output(0);
    Serial.printf("[%s] input type=%d dims=[", name_, (int)in_->type);
    for (int i = 0; i < in_->dims->size; i++) Serial.printf("%d ", in_->dims->data[i]);
    Serial.printf("] scale=%.6f zp=%d | arena dipakai=%u B\n", in_->params.scale,
                  (int)in_->params.zero_point, (unsigned)interp_->arena_used_bytes());
    ok_ = true;
    return true;
  }

  bool ready() const { return ok_; }
  TfLiteTensor* input() { return in_; }
  bool run() { return ok_ && interp_->Invoke() == kTfLiteOk; }

  // Probabilitas kelas idx. Jika output hanya 1 unit (sigmoid), idx diabaikan.
  float prob(int idx) {
    const int n = out_->dims->data[out_->dims->size - 1];
    if (n == 1) idx = 0;
    if (out_->type == kTfLiteInt8)
      return ((int)out_->data.int8[idx] - out_->params.zero_point) * out_->params.scale;
    if (out_->type == kTfLiteUInt8)
      return ((int)out_->data.uint8[idx] - out_->params.zero_point) * out_->params.scale;
    return out_->data.f[idx];
  }

 private:
  const char* name_ = "";
  bool ok_ = false;
  const tflite::Model* model_ = nullptr;
  tflite::MicroInterpreter* interp_ = nullptr;
  uint8_t* arena_ = nullptr;
  TfLiteTensor *in_ = nullptr, *out_ = nullptr;
};
