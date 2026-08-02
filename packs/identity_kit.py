"""
Identity Kit builder — Phase 1.

The kit is 12+ images of ONE face, varied in light, expression and framing. It is
the training set for the LoRA that finally locks identity (blueprint F1), and the
reference set the face_match_score gate measures against.

Why img2img and not an identity adapter: our base is Freepik/flux.1-lite-8B, an
8B distillation with 8 double blocks where FLUX.1-dev has 19. PuLID and the Flux
IP-Adapters inject into those blocks, so they are architecturally incompatible with
this base — measured, not assumed. img2img needs no adapter: it starts from our own
master image and re-noises it, so the face survives while light and expression move.

Nothing here swaps or borrows a face. The only input is the master image this
project generated, and the only output is variations of it.

  python identity_kit.py --master flux-v2/face-301.png --n 20 --out characters/seraphinne
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
AI_DISCLOSURE = "AI-generated model. Not a real person."

# Each entry varies ONE thing so the LoRA sees the same person under different
# conditions rather than a different person each time. Strength is deliberately
# modest: past ~0.6 the face drifts into someone else, which the cull then rejects
# and the run wastes GPU time.
VARIATIONS = [
    ("front-soft",    0.32, "soft even frontal light, neutral calm expression"),
    ("front-warm",    0.36, "warm golden hour light from the front, faint smile"),
    ("side-left",     0.42, "head turned slightly to her left, soft key light from the left"),
    ("side-right",    0.42, "head turned slightly to her right, soft key light from the right"),
    ("window",        0.38, "soft diffused window light from one side, serene expression"),
    ("studio-flat",   0.34, "flat clean studio beauty light, neutral expression, plain background"),
    ("golden-rim",    0.44, "warm backlit rim light on the hair, soft fill on the face"),
    ("overcast",      0.40, "cool overcast daylight, natural relaxed expression"),
    ("smile",         0.38, "gentle closed-mouth smile, soft even light"),
    ("chin-up",       0.45, "chin lifted slightly, confident calm gaze"),
]


def _pipe():
    import torch
    from diffusers import FluxImg2ImgPipeline, FluxTransformer2DModel
    from diffusers import BitsAndBytesConfig as DBnb
    from transformers import T5EncoderModel, BitsAndBytesConfig as TBnb

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    print("loading 4-bit img2img pipeline...")
    t0 = time.time()
    dq = DBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    transformer = FluxTransformer2DModel.from_pretrained(
        REPO, subfolder="transformer", quantization_config=dq, torch_dtype=torch.bfloat16, token=token)
    tq = TBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    te2 = T5EncoderModel.from_pretrained(
        REPO, subfolder="text_encoder_2", quantization_config=tq, torch_dtype=torch.bfloat16, token=token)
    pipe = FluxImg2ImgPipeline.from_pretrained(
        REPO, transformer=transformer, text_encoder_2=te2, torch_dtype=torch.bfloat16, token=token)
    pipe.enable_model_cpu_offload()
    print(f"pipeline ready in {time.time()-t0:.0f}s")
    return pipe


def _detector():
    from insightface.app import FaceAnalysis
    apps = []
    # 320 first: a large centred face is missed at 640 — measured, cost a debug round.
    for det in [(320, 320), (640, 640)]:
        a = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        a.prepare(ctx_id=-1, det_size=det)
        apps.append(a)
    return apps


def _embed(path_or_img, apps):
    import numpy as np
    from PIL import Image
    img = Image.open(path_or_img) if isinstance(path_or_img, (str, Path)) else path_or_img
    arr = np.ascontiguousarray(np.array(img.convert("RGB"))[:, :, ::-1])
    for a in apps:
        got = a.get(arr)
        if got:
            f = max(got, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
            return f.normed_embedding, float(f.det_score)
    return None, 0.0


def build(master: Path, n: int, out: Path, gate: float, seed: int) -> int:
    import numpy as np
    import torch
    from PIL import Image

    spec = json.loads((out.parent / f"{out.name}.json").read_text(encoding="utf-8")) \
        if (out.parent / f"{out.name}.json").exists() else {}
    face_lock = spec.get("face_lock", "")

    apps = _detector()
    master_img = Image.open(master).convert("RGB")
    m_emb, m_det = _embed(master, apps)
    if m_emb is None:
        print(f"no face detected in master {master} — pick another"); return 1
    print(f"master: {master}  det_score {m_det:.3f}")

    acc = out / "accepted"
    rej = out / "rejected"
    acc.mkdir(parents=True, exist_ok=True)
    rej.mkdir(parents=True, exist_ok=True)

    pipe = _pipe()
    # Square 768: the training crop is square, and generating at the target shape
    # avoids a resize that softens exactly the facial detail the LoRA must learn.
    base = master_img.resize((768, 768), Image.LANCZOS)

    report = {"master": str(master), "gate": gate, "generated_at":
              time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "disclosure": AI_DISCLOSURE, "images": []}
    kept = 0

    for i in range(n):
        name, strength, look = VARIATIONS[i % len(VARIATIONS)]
        s = seed + i
        prompt = (f"beauty portrait photograph of one woman, {look}, {face_lock}, "
                  "sharp focus on the eyes, natural skin texture with visible pores, "
                  "photorealistic, editorial beauty photography")
        t0 = time.time()
        img = pipe(prompt=prompt, image=base, strength=strength,
                   num_inference_steps=26, guidance_scale=3.5,
                   generator=torch.Generator("cpu").manual_seed(s)).images[0]

        emb, det = _embed(img, apps)
        sim = float(np.dot(m_emb, emb)) if emb is not None else None
        ok = sim is not None and sim >= gate
        fname = f"{name}-{i:02d}-{s}.png"
        img.save((acc if ok else rej) / fname)
        report["images"].append({"file": fname, "variation": name, "strength": strength,
                                 "seed": s, "similarity": round(sim, 3) if sim else None,
                                 "det_score": round(det, 3), "accepted": ok})
        kept += int(ok)
        mark = "OK " if ok else "rej"
        print(f"{mark} {fname:<26} sim {sim if sim else float('nan'):.3f}  {time.time()-t0:.0f}s")

    sims = [r["similarity"] for r in report["images"] if r["similarity"] is not None]
    report["accepted_count"] = kept
    report["generated_count"] = n
    if sims:
        report["similarity_avg"] = round(sum(sims) / len(sims), 3)
        report["similarity_min"] = round(min(sims), 3)
    # 12 is the blueprint's own floor for a trainable Identity Kit.
    report["kit_ready"] = kept >= 12
    (out / "identity_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"\naccepted {kept}/{n} at gate {gate}")
    if sims:
        print(f"similarity avg {report['similarity_avg']}  min {report['similarity_min']}")
    print(f"KIT READY (>=12): {'YES' if report['kit_ready'] else 'NO'}")
    print(AI_DISCLOSURE)
    return 0 if report["kit_ready"] else 3


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path, required=True)
    p.add_argument("--n", type=int, default=20)
    p.add_argument("--out", type=Path, default=Path("characters/seraphinne"))
    p.add_argument("--gate", type=float, default=0.75)
    p.add_argument("--seed", type=int, default=9000)
    a = p.parse_args()
    return build(a.master, a.n, a.out, a.gate, a.seed)


if __name__ == "__main__":
    sys.exit(main())
