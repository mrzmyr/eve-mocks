# /// script
# dependencies = ["kokoro-onnx>=0.4.9", "soundfile", "numpy"]
# ///
import sys, json, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("tts/model_fp16.onnx", "tts/voices-v1.0.bin")
voice = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
segs = json.load(open("script.json"))
out = []
for i, s in enumerate(segs):
    a, sr = k.create(s["text"], voice=voice, speed=s.get("speed", 1.0), lang="en-us")
    sf.write(f"tts/seg{i}.wav", a, sr)
    out.append({"i": i, "start": s["start"], "dur": round(len(a) / sr, 2)})
    print(out[-1])
json.dump(out, open("tts/durs.json", "w"))
