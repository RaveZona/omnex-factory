"""
Face refinement pass — brings small faces up to the identity gate.

Measured problem this solves: with the identity LoRA the six-scene campaign scores
avg 0.677, but the two FULL-LENGTH shots score 0.513 and 0.562. The pattern is not
random — in a head-to-feet frame the face is a few percent of the pixels, so there
is simply not enough of it for identity to survive. Close and half shots in the same
run score 0.75-0.82.

Fix is resolution, not strength: crop the face region, scale it so the face fills a
full canvas, re-run Flux img2img WITH the identity LoRA at low strength, and paste
it back through a feathered mask. Everything outside the paste is the untouched
original.

Why this is safe now and was not before: the earlier two-stage attempt used an SD1.5
pipeline, which would have repainted a Flux face at SD1.5 quality — the most valuable
region degraded. Staying inside Flux + LoRA keeps the quality and reinforces identity
at the same time.

  python refine_face.py --dir seraphinne-lora --ref flux-v2/face-301.png --out seraphinne-final
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

REPO = "Freepik/flux.1-lite-8B"
TRIGGER = "seraphinne_vallora"
AI_DISCLOSURE = "AI-generated model. Not a real person."


def _token():
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")


def _detector():
    from insightface.app import FaceAnalysis
    apps = []
    for det in [(320, 320), (640, 640)]:
        a = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        a.prepare(ctx_id=-1, det_size=det)
        apps.append(a)
    return apps


def _find(img, apps):
    import numpy as np
    arr = np.ascontiguousarray(np.array(img.convert("RGB"))[:, :, ::-1])
    for a in apps:
        got = a.get(arr)
        if got:
            f = max(got, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
            return f.bbox, f.normed_embedding
    return None, None


def _pipe(lora: Path):
    import torch
    from diffusers import FluxImg2ImgPipeline, FluxTransformer2DModel
    from diffusers import BitsAndBytesConfig as DBnb
    from transformers import T5EncoderModel, BitsAndBytesConfig as TBnb
    from peft import LoraConfig, inject_adapter_in_model, set_peft_model_state_dict
    from safetensors.torch import load_file

    tok = _token()
    dq = DBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    tr = FluxTransformer2DModel.from_pretrained(
        REPO, subfolder="transformer", quantization_config=dq, torch_dtype=torch.bfloat16, token=tok)

    cfg = json.loads((lora / "adapter_config.json").read_text(encoding="utf-8"))
    lcfg = LoraConfig(r=cfg["r"], lora_alpha=cfg["lora_alpha"], lora_dropout=0.0,
                      bias="none", target_modules=cfg["target_modules"])
    tr = inject_adapter_in_model(lcfg, tr)
    sd = {k.replace("base_model.model.", ""): v
          for k, v in load_file(str(lora / "adapter_model.safetensors")).items()}
    set_peft_model_state_dict(tr, sd)
    print(f"LoRA injected rank={cfg['r']}")

    tq = TBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    te2 = T5EncoderModel.from_pretrained(REPO, subfolder="text_encoder_2",
                                         quantization_config=tq, torch_dtype=torch.bfloat16, token=tok)
    pipe = FluxImg2ImgPipeline.from_pretrained(
        REPO, transformer=tr, text_encoder_2=te2, torch_dtype=torch.bfloat16, token=tok)
    pipe.enable_model_cpu_offload()
    return pipe


def refine(src: Path, ref: Path, out: Path, lora: Path, strength: float,
           threshold: float, canvas: int) -> int:
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageFilter

    apps = _detector()
    _, ref_emb = _find(Image.open(ref), apps)
    if ref_emb is None:
        print(f"no face in reference {ref}"); return 1

    files = sorted(src.glob("*.png"))
    if not files:
        print(f"no PNGs in {src}"); return 1
    out.mkdir(parents=True, exist_ok=True)

    pipe = _pipe(lora)
    prompt = (f"{TRIGGER}, close-up portrait of one woman, natural skin texture with "
              "visible pores, sharp focus on the eyes, editorial beauty photography")
    report = {"reference": str(ref), "strength": strength, "threshold": threshold,
              "disclosure": AI_DISCLOSURE, "images": []}

    for f in files:
        img = Image.open(f).convert("RGB")
        bbox, emb = _find(img, apps)
        before = float(np.dot(ref_emb, emb)) if emb is not None else None

        if bbox is None:
            img.save(out / f.name)
            report["images"].append({"file": f.name, "refined": False, "reason": "no face"})
            print(f"{f.name:<20} no face — copied as-is")
            continue

        # Already strong enough: refining would risk changing a good face for nothing.
        if before is not None and before >= threshold:
            img.save(out / f.name)
            report["images"].append({"file": f.name, "refined": False,
                                     "before": round(before, 3), "after": round(before, 3)})
            print(f"{f.name:<20} {before:.3f} — above {threshold}, left alone")
            continue

        x1, y1, x2, y2 = bbox
        fw, fh = x2 - x1, y2 - y1
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        half = max(fw, fh) * 1.25
        L, T = max(0, int(cx - half)), max(0, int(cy - half * 1.15))
        R, B = min(img.width, int(cx + half)), min(img.height, int(cy + half * 0.95))
        crop = img.crop((L, T, R, B))
        cw, ch = crop.size

        t0 = time.time()
        fixed = pipe(prompt=prompt, image=crop.resize((canvas, canvas), Image.LANCZOS),
                     strength=strength, num_inference_steps=28, guidance_scale=3.5,
                     generator=torch.Generator("cpu").manual_seed(4242)).images[0]

        m = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(m).ellipse([cw * 0.08, ch * 0.05, cw * 0.92, ch * 0.95], fill=255)
        m = m.filter(ImageFilter.GaussianBlur(max(4, cw * 0.06)))
        merged = img.copy()
        merged.paste(fixed.resize((cw, ch), Image.LANCZOS), (L, T), m)
        merged.save(out / f.name)

        _, emb2 = _find(merged, apps)
        after = float(np.dot(ref_emb, emb2)) if emb2 is not None else None
        report["images"].append({"file": f.name, "refined": True,
                                 "face_px": int(fw * fh),
                                 "before": round(before, 3) if before else None,
                                 "after": round(after, 3) if after else None})
        d = f"{before:.3f} -> {after:.3f}" if before and after else "measured after only"
        print(f"{f.name:<20} {d}   {time.time()-t0:.0f}s")

    scores = [r.get("after") for r in report["images"] if r.get("after")]
    if scores:
        report["identity_average"] = round(sum(scores) / len(scores), 3)
        report["identity_worst"] = round(min(scores), 3)
        print(f"\nafter refinement: average {report['identity_average']}  "
              f"worst {report['identity_worst']}")
        print(f"GATE avg >= 0.65: {'PASS' if report['identity_average'] >= 0.65 else 'FAIL'}")
        print(f"GATE min >= 0.65: {'PASS' if report['identity_worst'] >= 0.65 else 'FAIL'}")
    (out / "refine_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(AI_DISCLOSURE)
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", type=Path, required=True)
    p.add_argument("--ref", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--lora", type=Path, default=Path("characters/seraphinne/lora"))
    p.add_argument("--strength", type=float, default=0.35)
    p.add_argument("--threshold", type=float, default=0.72,
                   help="faces already at or above this are left untouched")
    p.add_argument("--canvas", type=int, default=768)
    a = p.parse_args()
    return refine(a.dir, a.ref, a.out, a.lora, a.strength, a.threshold, a.canvas)


if __name__ == "__main__":
    sys.exit(main())
