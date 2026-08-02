"""
FLUX.1-schnell locally on 8 GB — the luxury tier for EUR 0.

Every free hosted route to Flux quality was exhausted and verified dead: SD1.5 is
not luxury, Pollinations Flux is soft, fal's balance is empty, HF serverless Flux
is deprecated (410). The one remaining EUR 0 path is running the real model here,
quantized. This is the model behind the Guess/Vogue-tier references.

How it fits 8 GB, and why each choice:
  * FLUX.1-schnell, not -dev: Apache 2.0 (ungated), and guidance-distilled to 4
    steps, so a quantized generation is a minute, not many.
  * The transformer (~12B) and the T5 text encoder (~5B) are the two memory hogs.
    Both are loaded in 4-bit NF4 (bitsandbytes), which turns ~46 GB of bf16
    weights into ~9 GB total.
  * enable_model_cpu_offload keeps only the running module on the GPU, so peak
    VRAM is one module at a time — this is what makes it fit on an 8 GB card that
    a full Flux pipeline (needs ~24 GB) never could.

Speed is the tradeoff, not quality. A minute-plus per image is fine for a
premium product; it is the exact luxury the packs could not reach.

  docker run --rm --gpus all -v D:/OMNEX_Factory/packs:/work -w /work \
      -v D:/OMNEX_Factory/.hfcache:/root/.cache/huggingface omnex/flux:1 \
      python flux_local.py --check
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

# Freepik/flux.1-lite-8B: an UNGATED, 8B-parameter distillation of FLUX.1-dev.
# Chosen over FLUX.1-schnell because schnell is auto-gated (the token is valid but
# the licence must be accepted on the website, which cannot be scripted), and
# because 8B fits 8 GB with more headroom than 12B. Being dev-derived it needs
# real guidance (~3.5) and more steps (~24) than schnell's 4, not guidance 0.
REPO = "Freepik/flux.1-lite-8B"
AI_DISCLOSURE = "AI-generated model. Not a real person."


def check() -> int:
    import torch
    print(f"torch {torch.__version__}")
    if not torch.cuda.is_available():
        print("GPU: NOT AVAILABLE — pass --gpus all"); return 1
    free, total = torch.cuda.mem_get_info()
    p = torch.cuda.get_device_properties(0)
    print(f"GPU: {p.name}  {total/1024**3:.2f} GB total, {free/1024**3:.2f} GB free")
    if free/1024**3 < 5.0:
        print("WARNING: under 5 GB free — stop other GPU users first")
    for mod in ["diffusers", "bitsandbytes", "transformers", "accelerate", "sentencepiece"]:
        try:
            __import__(mod); print(f"{mod}: installed")
        except ImportError:
            print(f"{mod}: MISSING"); return 2
    # bitsandbytes must actually have a CUDA build, not just import.
    import bitsandbytes as bnb
    import torch as t
    x = t.zeros(8, 8, device="cuda")
    _ = bnb.nn.Linear4bit(8, 8).cuda()(x.to(t.float16))
    print("bitsandbytes 4-bit on CUDA: usable")
    print("\nREADY")
    return 0


def _pipe():
    import torch
    from diffusers import FluxPipeline, FluxTransformer2DModel
    from diffusers import BitsAndBytesConfig as DBnb
    from transformers import T5EncoderModel, BitsAndBytesConfig as TBnb

    # FLUX.1-schnell is auto-gated: from_pretrained does NOT pick up HF_TOKEN from
    # the environment for a gated repo (model_info does, which is misleading), so
    # the token must be passed explicitly or every call 404s as "not a valid id".
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        print("no HF_TOKEN in env — a gated repo cannot download without it"); raise SystemExit(2)

    print("loading 4-bit transformer (first run downloads ~24 GB)...")
    t0 = time.time()
    dq = DBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    transformer = FluxTransformer2DModel.from_pretrained(
        REPO, subfolder="transformer", quantization_config=dq, torch_dtype=torch.bfloat16, token=token)

    lora = os.environ.get("FLUX_LORA")
    if lora:
        # pipe.load_lora_weights() cannot read this adapter: peft saves keys as
        # base_model.model.<module>, while the diffusers Flux loader expects the
        # original BFL naming (double_blocks.0.img_mod.lin...) and raises KeyError.
        # inject_adapter_in_model applies the adapter in place, so the object stays
        # a FluxTransformer2DModel and the pipeline still finds .config.
        import json as _json
        from peft import LoraConfig, inject_adapter_in_model, set_peft_model_state_dict
        from safetensors.torch import load_file
        cfg_raw = _json.loads((Path(lora) / "adapter_config.json").read_text(encoding="utf-8"))
        lcfg = LoraConfig(r=cfg_raw["r"], lora_alpha=cfg_raw["lora_alpha"], lora_dropout=0.0,
                          bias="none", target_modules=cfg_raw["target_modules"])
        transformer = inject_adapter_in_model(lcfg, transformer)
        sd = load_file(str(Path(lora) / "adapter_model.safetensors"))
        sd = {k.replace("base_model.model.", ""): v for k, v in sd.items()}
        res = set_peft_model_state_dict(transformer, sd)
        missing = len(getattr(res, "unexpected_keys", []) or [])
        print(f"LoRA injected from {lora}  rank={cfg_raw['r']}  unexpected_keys={missing}")

    tq = TBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    text_encoder_2 = T5EncoderModel.from_pretrained(
        REPO, subfolder="text_encoder_2", quantization_config=tq, torch_dtype=torch.bfloat16, token=token)

    pipe = FluxPipeline.from_pretrained(
        REPO, transformer=transformer, text_encoder_2=text_encoder_2, torch_dtype=torch.bfloat16, token=token)
    # Only the active module sits on the GPU — the reason this fits at all.
    pipe.enable_model_cpu_offload()
    print(f"pipeline ready in {time.time()-t0:.0f}s")
    return pipe


def generate(prompt: str, out: Path, w: int, h: int, steps: int, seed: int, count: int,
             guidance: float, jobs_file: Path | None = None) -> int:
    """One pipeline load, many prompts.

    Loading the quantized pipeline costs ~2 minutes; generating costs ~55s. Running
    a second batch as a second process paid that load again for nothing, so a jobs
    file lets one load serve every prompt in a session.

    Jobs file format, one job per line:  name | WxH | count | prompt
    """
    import torch
    pipe = _pipe()
    out.mkdir(parents=True, exist_ok=True)

    jobs = []
    if jobs_file:
        for line in jobs_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|", 3)]
            if len(parts) != 4:
                print(f"skipping malformed job: {line[:60]}"); continue
            name, size, cnt, ptext = parts
            jw, jh = (int(v) for v in size.lower().split("x"))
            jobs.append((name, jw, jh, int(cnt), ptext))
    else:
        jobs.append(("flux", w, h, count, prompt))

    n = 0
    for name, jw, jh, cnt, ptext in jobs:
        for i in range(cnt):
            sd = seed + n
            t0 = time.time()
            img = pipe(ptext, width=jw, height=jh, num_inference_steps=steps,
                       guidance_scale=guidance,
                       generator=torch.Generator("cpu").manual_seed(sd)).images[0]
            f = out / f"{name}-{sd}.png"
            img.save(f)
            n += 1
            print(f"{f.name}  {jw}x{jh}  {time.time()-t0:.0f}s")
    print(AI_DISCLOSURE)
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--prompt", default=(
        "Editorial Vogue fashion photograph of a 25 year old luxury fashion model, "
        "harmonious oval face, high sculpted cheekbones, large almond blue-green eyes "
        "with golden limbal ring, naturally full eyebrows, straight refined European nose, "
        "full lips with cupids bow, flawless skin with realistic pores and soft peach "
        "undertones, long honey-blonde hair with golden highlights in loose waves, quiet "
        "confident expression, old-money European luxury couture styling, golden hour soft "
        "window light, medium format Hasselblad 100mm portrait, ultra realistic, 8k, "
        "photorealistic, award-winning fashion photography"))
    p.add_argument("--out", type=Path, default=Path("flux-out"))
    p.add_argument("--w", type=int, default=768)
    p.add_argument("--h", type=int, default=1024)
    p.add_argument("--steps", type=int, default=24)
    p.add_argument("--guidance", type=float, default=3.5)
    p.add_argument("--seed", type=int, default=101)
    p.add_argument("--count", type=int, default=1)
    p.add_argument("--jobs", type=Path, help="file of 'name | WxH | count | prompt' lines")
    a = p.parse_args()
    if a.check:
        return check()
    return generate(a.prompt, a.out, a.w, a.h, a.steps, a.seed, a.count, a.guidance, a.jobs)


if __name__ == "__main__":
    sys.exit(main())
