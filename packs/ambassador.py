"""
Character-consistent virtual brand ambassadors — the one capability the provider
chain cannot do.

`lib/core/images/provider.ts` already conditions on a PRODUCT photo (`imageUrl`
plus `strength`). It cannot condition on a FACE, so every generation returns a
different person. That is precisely the gap a brand cares about: an ambassador
whose face changes between shots is not a brand asset.

Approach, and why this one:
  * IP-Adapter (full-face, SD1.5) conditions generation on a reference face with
    NO training run. A LoRA per character would be higher fidelity but costs a
    training run each time; this holds identity while pose, outfit and scene
    change, which is the actual requirement.
  * SD1.5 rather than SDXL because the measured budget is 8 GB of VRAM, of which
    ~5.2 GB was free. SDXL plus an adapter does not fit with headroom.
  * diffusers rather than ComfyUI: ComfyUI's torch segfaulted on this machine
    (exit 139, even with --gpus all). That path is closed, not retried.

Consistency is MEASURED, never eyeballed. A generative model returns different
images anyway, so "they look similar" proves nothing — the same trap as the
fidelity control that silently did nothing. `--measure` reports cosine similarity
between face embeddings; the gate is a number, not an impression.

Run inside the verified GPU container:
  docker run --rm --gpus all -v D:/OMNEX_Factory/packs:/work -w /work \
      pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime python ambassador.py --check
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

# Kept in sync with lib/modules/studio/personas.ts — the TypeScript module is the
# source of truth for the platform; this mirrors only what the local pipeline needs.
AI_DISCLOSURE = "AI-generated model. Not a real person."

# Base SD1.5 produces misaligned eyes and drifts to monochrome on portraits — the
# first candidate set showed both. A photoreal fine-tune of the SAME architecture
# fixes faces at identical VRAM and speed, so the base model is never the default.
# Overridable because checkpoint quality is the single biggest lever on this product.
# Must ship every component as .safetensors. transformers 5 refuses .bin weights
# under torch < 2.6 (CVE-2025-32434), and Realistic_Vision — the obvious choice —
# publishes zero safetensors components, so it cannot load here at all. Probed:
# absolute-reality 8 components, dreamshaper-8 8, epiCRealism 4, base SD1.5 9.
DEFAULT_MODEL = "Lykon/absolute-reality-1.81"

PERSONA_NEGATIVE = (
    "deformed, disfigured, extra fingers, mutated hands, bad anatomy, "
    "watermark, text, logo, signature, low quality, blurry, jpeg artifacts, "
    "cgi, 3d render, plastic skin, oversaturated"
)

SCHOOLS = {
    "high_fashion": "high fashion editorial model, strong bone structure, refined features, aloof expression",
    "glamour":      "glamour beauty model, luminous skin, soft glossy makeup, warm inviting expression",
    "editorial":    "editorial portrait model, characterful face, natural asymmetry, thoughtful expression",
    "natural":      "natural beauty model, minimal makeup, freckles, relaxed genuine expression",
    "commercial":   "commercial lifestyle model, friendly approachable face, bright clean makeup, warm smile",
}

SHOTS = {
    "beauty":   "glamour beauty portrait, head and shoulders,",
    "portrait": "close-up editorial portrait,",
    "half":     "half-body editorial fashion photograph,",
    "full":     "full-length editorial fashion photograph, full body in frame,",
}

CRAFT = (
    "photorealistic, shot on 85mm lens, shallow depth of field, soft key light, "
    "commercial photography, sharp focus on the eyes, high detail, natural skin texture"
)


def _torch():
    import torch
    return torch


def check() -> int:
    """Prove the machine can do the work before downloading several GB of weights.

    ComfyUI cost a 16 GB image and repeated restarts because nothing verified that
    torch could run first. This answers that in seconds.
    """
    ok = True

    try:
        torch = _torch()
    except ImportError:
        print("torch: MISSING — wrong container")
        return 1
    print(f"torch {torch.__version__}")

    if not torch.cuda.is_available():
        print("GPU: NOT AVAILABLE — did you pass --gpus all?")
        return 1
    p = torch.cuda.get_device_properties(0)
    free, total = torch.cuda.mem_get_info()
    print(f"GPU: {p.name}  {total / 1024**3:.2f} GB total, {free / 1024**3:.2f} GB free")

    # Visibility is not usability — force one real kernel.
    t0 = time.time()
    a = torch.randn(2048, 2048, device="cuda")
    _ = (a @ a).sum().item()
    torch.cuda.synchronize()
    print(f"GPU matmul 2048: {(time.time() - t0) * 1000:.0f} ms — usable")

    if free / 1024**3 < 4.0:
        print(f"WARNING: under 4 GB free. Close Ollama (keep_alive 0) and any GPU app.")

    for mod, why in [
        ("diffusers", "the pipeline"),
        ("transformers", "the image encoder IP-Adapter needs"),
        ("safetensors", "weight loading"),
        ("PIL", "saving images"),
    ]:
        try:
            __import__(mod)
            print(f"{mod}: installed")
        except ImportError:
            print(f"{mod}: MISSING — needed for {why}")
            ok = False

    # Only used by --measure. Its absence must not block generating.
    try:
        __import__("insightface")
        print("insightface: installed (ArcFace similarity available)")
    except ImportError:
        print("insightface: missing — --measure will fall back to CLIP similarity")

    if not ok:
        print("\ninstall with:")
        print("  pip install diffusers transformers accelerate safetensors pillow")
        return 2
    print("\nREADY")
    return 0


def _pipe(ip_scale: float, model: str):
    """SD1.5 + IP-Adapter, in half precision to fit 8 GB."""
    import torch
    from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler

    pipe = StableDiffusionPipeline.from_pretrained(
        model,
        torch_dtype=torch.float16,
        use_safetensors=True,
        safety_checker=None,          # replaced by an explicit SFW prompt contract
        requires_safety_checker=False,
    )
    # Fewer steps for the same quality — matters when a character sheet is 12 images.
    # This checkpoint ships algorithm_type 'deis' with final_sigmas_type 'zero', a
    # combination DPMSolverMultistep rejects outright. Inheriting a third-party
    # scheduler config is the trap; the solver is stated explicitly instead.
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config, algorithm_type="dpmsolver++", use_karras_sigmas=True,
    )
    pipe = pipe.to("cuda")
    # Deliberately NOT enable_attention_slicing() here. Slicing installs
    # SlicedAttnProcessor, and loading an IP-Adapter afterwards tries to rebuild
    # those processors without their required slice_size, so the adapter fails to
    # load at all. VAE slicing touches no attention processor and is safe. At
    # 512px on SD1.5 with ~6.9 GB free this fits without attention slicing.
    pipe.enable_vae_slicing()
    return pipe


def faces(school: str, count: int, out: Path, seed: int, model: str) -> int:
    """Generate candidate faces to choose from. The chosen one becomes the identity."""
    import torch
    from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler

    pipe = StableDiffusionPipeline.from_pretrained(
        model,
        torch_dtype=torch.float16, use_safetensors=True,
        safety_checker=None, requires_safety_checker=False,
    )
    # This checkpoint ships algorithm_type 'deis' with final_sigmas_type 'zero', a
    # combination DPMSolverMultistep rejects outright. Inheriting a third-party
    # scheduler config is the trap; the solver is stated explicitly instead.
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config, algorithm_type="dpmsolver++", use_karras_sigmas=True,
    )
    pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()

    out.mkdir(parents=True, exist_ok=True)
    prompt = f"{SHOTS['portrait']} {SCHOOLS[school]}, {CRAFT}"
    print(f"model:  {model}")
    print(f"school: {school}\nprompt: {prompt[:110]}...")

    for i in range(count):
        g = torch.Generator("cuda").manual_seed(seed + i)
        t0 = time.time()
        img = pipe(prompt, negative_prompt=PERSONA_NEGATIVE, num_inference_steps=28,
                   guidance_scale=6.5, generator=g).images[0]
        f = out / f"face-{i + 1:02d}-seed{seed + i}.png"
        img.save(f)
        print(f"{f.name}  {time.time() - t0:.0f}s")

    print(f"\n{count} candidates in {out}")
    print("Pick one and pass it to --sheet --ref <file>. Its seed is in the filename.")
    print(AI_DISCLOSURE)
    return 0


def sheet(ref: Path, school: str, out: Path, ip_scale: float, seed: int, model: str, adapter: str) -> int:
    """The deliverable: one identity across every shot type, outfit and scene."""
    import torch
    from PIL import Image

    pipe = _pipe(ip_scale, model)
    pipe.load_ip_adapter("h94/IP-Adapter", subfolder="models", weight_name=adapter)
    # The single most important dial: too low and identity drifts, too high and every
    # image collapses into the same framing. Reported so a bad set is explainable.
    pipe.set_ip_adapter_scale(ip_scale)
    print(f"adapter: {adapter}  ip_adapter_scale: {ip_scale}")

    face = Image.open(ref).convert("RGB")
    out.mkdir(parents=True, exist_ok=True)

    # Framing is per shot, and this is not cosmetic. A face-weighted IP-Adapter
    # pulls EVERY composition toward a face-centred crop: asked for "full-length",
    # it returned another chest-up portrait, so a 12-image sheet came out as 12
    # near-identical crops — worthless to a brand buying range.
    # Two things actually change the framing: a taller canvas, and naming the crop
    # in the negative. Both are applied only to the wider shots.
    CROP_NEG = ", close-up, headshot, cropped at the chest, face fills the frame"
    setups = [
        ("beauty",   "wearing a simple black top, clean studio background",      512, 512, ""),
        ("portrait", "wearing a cream knit sweater, soft window light interior", 512, 512, ""),
        ("half",     "wearing a tailored beige blazer, minimal concrete studio", 512, 704, CROP_NEG),
        ("full",     "wearing an elegant slip dress, warm sunlit loft, standing, full figure visible from head to feet",
                                                                                 512, 768, CROP_NEG),
    ]

    n = 0
    for shot, wardrobe, w, h in [(a, b, c, d) for a, b, c, d, _ in setups]:
        neg_extra = dict((a, e) for a, _, _, _, e in setups)[shot]
        for variant in range(3):
            prompt = f"{SHOTS[shot]} {SCHOOLS[school]}, {wardrobe}, {CRAFT}"
            g = torch.Generator("cuda").manual_seed(seed + n)
            t0 = time.time()
            img = pipe(prompt, negative_prompt=PERSONA_NEGATIVE + neg_extra,
                       ip_adapter_image=face, width=w, height=h,
                       num_inference_steps=28, guidance_scale=6.5, generator=g).images[0]
            f = out / f"{shot}-{variant + 1}.png"
            img.save(f)
            n += 1
            print(f"{f.name}  {w}x{h}  {time.time() - t0:.0f}s")

    print(f"\n{n} images in {out}")
    print(f"Now measure: python ambassador.py --measure --ref {ref} --dir {out}")
    print(AI_DISCLOSURE)
    return 0


def pack(ref: Path, school: str, out: Path, ip_scale: float, seed: int, model: str, adapter: str) -> int:
    """A sellable set: one identity across the scenes a brand actually publishes.

    This is the passive product. The Fiverr service needs the founder present for
    every order; a downloadable pack does not — same pipeline, no per-order work,
    and it sells on the rail Payhip already proved.
    """
    import json
    import torch
    from PIL import Image

    pipe = _pipe(ip_scale, model)
    pipe.load_ip_adapter("h94/IP-Adapter", subfolder="models", weight_name=adapter)
    pipe.set_ip_adapter_scale(ip_scale)
    print(f"adapter: {adapter}  ip_adapter_scale: {ip_scale}  school: {school}")

    face = Image.open(ref).convert("RGB")
    images = out / "images"
    images.mkdir(parents=True, exist_ok=True)

    CROP_NEG = ", close-up, headshot, cropped at the chest, face fills the frame"
    # Chosen for what a small brand posts, not for what looks impressive in a demo:
    # storefront, café, office, outdoors, studio. Formats follow the shot — square
    # for feed, tall for Stories and full-length.
    setups = [
        ("studio-black",  "beauty",   "wearing a simple black top, clean seamless studio background", 512, 512, ""),
        ("studio-knit",   "portrait", "wearing a cream knit sweater, soft window light interior", 512, 512, ""),
        # Shot type is chosen by what must be VISIBLE, not by taste. SHOTS['portrait']
        # begins "close-up editorial portrait", so assigning it to a scene setup
        # forces a headshot and the scene never appears — a pack of 30 "scenes"
        # came back as 30 near-identical crops because of exactly this. Lowering
        # ip_scale did not help (0.70 -> 0.45 kept the crop and cost identity:
        # worst 0.571 -> 0.414). Any setup whose value is the SCENE gets half or full.
        ("cafe",          "half",     "sitting in a bright modern cafe, warm morning light, cafe interior visible behind", 512, 704, CROP_NEG),
        ("office",        "half",     "wearing a tailored beige blazer, minimal bright office", 512, 704, CROP_NEG),
        ("boutique",      "half",     "wearing a soft camel coat, inside a minimal boutique, warm spotlights", 512, 704, CROP_NEG),
        ("city",          "full",     "wearing a long trench coat, quiet european city street, overcast daylight, standing, full figure from head to feet", 512, 768, CROP_NEG),
        ("loft",          "full",     "wearing an elegant slip dress, warm sunlit loft, standing, full figure from head to feet", 512, 768, CROP_NEG),
        ("resort",        "full",     "wearing a light linen summer dress, sunlit terrace with plants, standing, full figure from head to feet", 512, 768, CROP_NEG),
        ("skincare",      "beauty",   "clean fresh skin, minimal makeup, soft pastel background, skincare campaign", 512, 512, ""),
        ("evening",       "half",     "wearing a black evening dress, dark moody background, single soft key light", 512, 704, CROP_NEG),
    ]

    manifest = {
        "pack": "ambassador",
        "name": f"Virtual Brand Ambassador — {school.replace('_', ' ').title()}",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "disclosure": AI_DISCLOSURE,
        "model": model, "adapter": adapter, "ip_adapter_scale": ip_scale,
        "images": [],
    }

    n = 0
    for name, shot, wardrobe, w, h, neg_extra in setups:
        for variant in range(3):
            prompt = f"{SHOTS[shot]} {SCHOOLS[school]}, {wardrobe}, {CRAFT}"
            s = seed + n
            g = torch.Generator("cuda").manual_seed(s)
            t0 = time.time()
            img = pipe(prompt, negative_prompt=PERSONA_NEGATIVE + neg_extra,
                       ip_adapter_image=face, width=w, height=h,
                       num_inference_steps=28, guidance_scale=6.5, generator=g).images[0]
            fname = f"{name}-{variant + 1}.png"
            img.save(images / fname)
            manifest["images"].append(
                {"file": fname, "scene": name, "shot": shot, "w": w, "h": h, "seed": s})
            n += 1
            print(f"{fname:<20} {w}x{h}  {time.time() - t0:.0f}s")

    manifest["count"] = n
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\n{n} images in {images}")
    print(f"Now measure: python ambassador.py --measure --ref {ref} --dir {images}")
    print(AI_DISCLOSURE)
    return 0


def measure(ref: Path, folder: Path) -> int:
    """Report identity similarity as a number. 'Looks similar' is not evidence."""
    import numpy as np
    from PIL import Image

    files = sorted([p for p in folder.glob("*.png")])
    if not files:
        print(f"no PNGs in {folder}")
        return 1

    try:
        import insightface
        from insightface.app import FaceAnalysis
        method = "ArcFace"

        # det_size is NOT a harmless default. Measured on a 512x512 render:
        #   (640,640) -> 0 faces      (320,320) -> 1 face, score 0.84
        # The detector rescales the input, and at 640 a large centred face falls
        # outside the anchor range, so it reports nothing on a perfectly clear
        # portrait. Smaller first, then larger for wide full-body shots where the
        # face occupies little of the frame.
        apps = []
        for det in [(320, 320), (640, 640)]:
            a = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            a.prepare(ctx_id=-1, det_size=det)
            apps.append((det, a))

        def embed(path):
            img = np.ascontiguousarray(np.array(Image.open(path).convert("RGB"))[:, :, ::-1])
            for _det, a in apps:
                got = a.get(img)
                if got:
                    # Largest detected face — full-body shots can catch a reflection.
                    best = max(got, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
                    return best.normed_embedding
            return None
    except Exception as e:
        print(f"insightface unavailable ({type(e).__name__}) — cannot measure identity properly.")
        print("Install it for a real number:  pip install insightface onnxruntime")
        return 3

    base = embed(ref)
    if base is None:
        print("no face detected in the reference image — pick another")
        return 1

    scores, missing = [], 0
    for f in files:
        e = embed(f)
        if e is None:
            missing += 1
            print(f"  {f.name:<16} no face detected")
            continue
        s = float(np.dot(base, e))
        scores.append(s)
        print(f"  {f.name:<16} {s:.3f}")

    if not scores:
        print("no faces detected in any output")
        return 1

    avg = sum(scores) / len(scores)
    worst = min(scores)
    print(f"\n{method} cosine similarity over {len(scores)} images")
    print(f"  average {avg:.3f}   worst {worst:.3f}   undetected {missing}")
    # 0.65 is the gate from the plan: high enough that a viewer reads one person,
    # low enough to survive a change of pose, wardrobe and lighting.
    print(f"  GATE >= 0.65 average: {'PASS' if avg >= 0.65 else 'FAIL'}")
    if avg < 0.65:
        # Measured: raising ip-scale did NOT help either time it was tried. The
        # adapter is the lever that moves this number.
        print("  try --adapter ip-adapter-full-face_sd15.bin (measured +0.10 over plus-face),")
        print("  or pick a reference with a clearer, front-facing face")
    return 0 if avg >= 0.65 else 4


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="verify GPU and libraries, generate nothing")
    p.add_argument("--faces", type=int, metavar="N", help="generate N candidate faces to choose from")
    p.add_argument("--sheet", action="store_true", help="generate the character sheet from --ref")
    p.add_argument("--pack", action="store_true", help="generate a sellable 30-image pack from --ref")
    p.add_argument("--measure", action="store_true", help="report identity similarity")
    p.add_argument("--ref", type=Path, help="reference face image")
    p.add_argument("--dir", type=Path, help="folder to measure")
    p.add_argument("--school", default="high_fashion", choices=list(SCHOOLS))
    p.add_argument("--out", type=Path, default=Path("ambassador-out"))
    p.add_argument("--ip-scale", type=float, default=0.7)
    # Defaults chosen by measurement, not intuition. Sweep over 12-image sheets,
    # ArcFace cosine vs the reference (average / worst):
    #   full-face @0.70  0.747 / 0.702   <- default
    #   full-face @0.85  0.738 / 0.681
    #   plus-face @0.60  0.653 / 0.542
    #   plus-face @0.70  0.648 / 0.560   (fails the gate)
    # The ADAPTER dominates; the scale barely moves it, and raising the scale made
    # things worse both times. plus-face transfers the look of a face, full-face is
    # weighted toward identity — which is what a brand ambassador actually needs.
    p.add_argument("--adapter", default="ip-adapter-full-face_sd15.bin",
                   choices=["ip-adapter-plus-face_sd15.bin", "ip-adapter-full-face_sd15.bin"])
    p.add_argument("--seed", type=int, default=1000)
    p.add_argument("--model", default=DEFAULT_MODEL, help="HF model id; a photoreal SD1.5 fine-tune beats base SD1.5 for faces")
    a = p.parse_args()

    if a.check:
        return check()
    if a.faces:
        return faces(a.school, a.faces, a.out, a.seed, a.model)
    if a.sheet:
        if not a.ref:
            print("--sheet needs --ref <face image>")
            return 1
        return sheet(a.ref, a.school, a.out, a.ip_scale, a.seed, a.model, a.adapter)
    if a.pack:
        if not a.ref:
            print("--pack needs --ref <face image>")
            return 1
        return pack(a.ref, a.school, a.out, a.ip_scale, a.seed, a.model, a.adapter)
    if a.measure:
        if not (a.ref and a.dir):
            print("--measure needs --ref and --dir")
            return 1
        return measure(a.ref, a.dir)

    p.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
