# Konversi haarcascade_frontalface_default.xml (OpenCV, Intel License) menjadi array C untuk ESP32.
import re, sys, cv2
def F(v):
    t=f'{v:.9g}'
    return t if ('.' in t or 'e' in t or 'n' in t) else t+'.0'

import xml.etree.ElementTree as ET
src = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
root = ET.parse(src).getroot().find('cascade')
W, H = int(root.find('width').text), int(root.find('height').text)
assert (W, H) == (24, 24)
feats = []
for f in root.find('features'):
    rects = []
    for r in f.find('rects'):
        x, y, w, h, wt = r.text.strip().split()
        assert float(wt) == int(float(wt))
        rects.append((int(x), int(y), int(w), int(h), int(float(wt))))
    assert f.find('tilted') is None or f.find('tilted').text.strip() == '0'
    assert len(rects) <= 3
    while len(rects) < 3: rects.append((0, 0, 0, 0, 0))
    feats.append(rects)
stages, stumps = [], []
for st in root.find('stages'):
    thr = float(st.find('stageThreshold').text)
    wcs = st.find('weakClassifiers')
    n = 0
    for wc in wcs:
        nodes = wc.find('internalNodes').text.split()
        assert nodes[0] == '0' and nodes[1] == '-1'
        fi, t = int(nodes[2]), float(nodes[3])
        l0, l1 = [float(v) for v in wc.find('leafValues').text.split()]
        stumps.append((fi, t, l0, l1)); n += 1
    stages.append((n, thr))
print(len(feats), 'fitur', len(stumps), 'stump', len(stages), 'stage')
with open('haar_data.h', 'w') as o:
    o.write('''#pragma once
// Cascade wajah frontal OpenCV (haarcascade_frontalface_default.xml, Rainer Lienhart).
// Intel License Agreement For Open Source Computer Vision Library,
// Copyright (C) 2000, Intel Corporation, all rights reserved. Hasil konversi otomatis
// (tools/gen_haar.py), jangan diedit manual. Stump-based, jendela dasar 24x24.
#include <stdint.h>
namespace haar_data {
''')
    o.write(f'constexpr int WIN = 24, N_FEAT = {len(feats)}, N_STUMP = {len(stumps)}, N_STAGE = {len(stages)};\n')
    o.write('// tiap fitur: 3 persegi (x,y,w,h,bobot); persegi kosong berbobot 0\n')
    o.write('const int8_t FEAT[N_FEAT][15] = {\n')
    for r in feats: o.write('{' + ','.join(str(v) for rr in r for v in rr) + '},\n')
    o.write('};\n')
    o.write('struct Stump { uint16_t f; float thr, l0, l1; };\n')
    o.write('const Stump STUMP[N_STUMP] = {\n')
    for fi, t, l0, l1 in stumps: o.write(f'{{{fi},{F(t)}f,{F(l0)}f,{F(l1)}f}},\n')
    o.write('};\n')
    o.write('struct Stage { uint16_t n; float thr; };\n')
    o.write('const Stage STAGE[N_STAGE] = {\n')
    for n, t in stages: o.write(f'{{{n},{F(t)}f}},\n')
    o.write('};\n}  // namespace haar_data\n')
