# Ubah file .tflite menjadi header C untuk sketch Arduino.
# Pemakaian:  python gen_header.py model_pemrosesan_suara_int8.tflite audio_model audio_model.h
import sys, os
src, name, dst = sys.argv[1], sys.argv[2], sys.argv[3]
b = open(src, 'rb').read()
with open(dst, 'w') as f:
    f.write(f"// sumber: {os.path.basename(src)} ({len(b)} byte)\n#pragma once\n")
    f.write(f"alignas(16) const unsigned char {name}[] = {{\n")
    for i in range(0, len(b), 16):
        f.write(','.join(f"0x{x:02x}" for x in b[i:i + 16]) + ',\n')
    f.write(f"}};\nconst unsigned int {name}_len = {len(b)};\n")
print(dst, len(b), 'byte')
