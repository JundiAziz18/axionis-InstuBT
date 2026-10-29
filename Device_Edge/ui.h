#pragma once
// Layar 7 pin (GND, 3V3, SCL, SDA, RES, DC, BLK) tanpa CS = ST7789 240x240.
// Jika ternyata modul bundar GC9A01, ganti baris gfx dengan:
//   new Arduino_GC9A01(bus, PIN_TFT_RST, 0, true)
#include <Arduino_GFX_Library.h>
#include "config.h"
#include "haar.h"

#define COL_BLACK  0x0000
#define COL_WHITE  0xFFFF
#define COL_RED    0xF800
#define COL_GREEN  0x07E0
#define COL_YELLOW 0xFFE0
#define COL_BLUE   0x001F

static Arduino_DataBus* uiBus = new Arduino_ESP32SPI(PIN_TFT_DC, GFX_NOT_DEFINED, PIN_TFT_SCK, PIN_TFT_MOSI, GFX_NOT_DEFINED);
static Arduino_GFX* gfx = new Arduino_ST7789(uiBus, PIN_TFT_RST, 0 /*rotasi*/, true /*IPS*/, 240, 240, 0, 0, 0, 80);

inline void uiInit() {
  pinMode(PIN_TFT_BL, OUTPUT);
  digitalWrite(PIN_TFT_BL, HIGH);
  if (!gfx->begin()) Serial.println("[ui] layar gagal init");
  gfx->fillScreen(COL_BLACK);
}

// Layar penuh dengan dua baris teks (instruksi, error, peringatan).
inline void uiMessage(const char* l1, const char* l2 = "", uint16_t bg = COL_BLACK, const char* l3 = "") {
  Serial.printf("[ui] %s | %s | %s\n", l1, l2, l3);
  gfx->fillScreen(bg);
  gfx->setRotation(2);
  gfx->setTextColor(COL_WHITE);
  gfx->setTextSize(3);
  gfx->setCursor(10, 70);  gfx->println(l1);
  gfx->setTextSize(2);
  gfx->setCursor(10, 135); gfx->println(l2);
  gfx->setCursor(10, 185); gfx->println(l3);
}

// Pratinjau kamera (RGB565 big-endian, 320x240) dipotong tengah 240x240, kotak wajah, dan footer.
inline void uiPreview(const uint8_t* buf, int fw, int fh, const haar::Box* face,
                      const char* footer, uint16_t footerColor) {
  const int xoff = (fw - 240) / 2;
  const int rows = fh < 240 ? fh : 240;
  for (int y = 0; y < rows; y++)
    gfx->draw16bitBeRGBBitmap(0, y, (uint16_t*)(buf + ((size_t)y * fw + xoff) * 2), 240, 1);
  if (face) gfx->drawRect(face->x - xoff, face->y, face->w, face->h, COL_GREEN);
  gfx->fillRect(0, 216, 240, 24, footerColor);
  gfx->setTextColor(COL_WHITE);
  gfx->setTextSize(2);
  gfx->setCursor(6, 220);
  gfx->print(footer);
}
