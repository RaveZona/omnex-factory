"""
Flux LoRA identity training on 8 GB — Phase 2B.

This is the only remaining path to a locked identity on this machine, and the one
the blueprint asks for in F1. Measured facts that rule out the alternatives:
  * Text-only FACE LOCK: ArcFace avg 0.547 / min 0.266 across six scenes — FAIL.
  * Identity adapters (PuLID, Flux IP-Adapter): our base Freepik/flux.1-lite-8B has
    8 double blocks where FLUX.1-dev has 19. They inject into those blocks, so they
    cannot attach. Config-checked, not assumed.
  * FLUX.1-Redux-dev: gated=auto — a valid token still 403s until a browser click.
  * A face swapper is deliberately not used: it is the deepfake vector, and a LoRA
    is better anyway because identity is generated rather than pasted.

How this fits 8 GB — the whole design is about what is NOT resident:
  1. CACHE PASS: encode every kit image to a latent with the VAE, and the caption
     once with CLIP+T5. Write both to disk. Then delete the VAE and both text
     encoders. They are never loaded again.
  2. TRAIN PASS: only the 4-bit transformer plus small LoRA adapters are resident.
     Batch 1, gradient checkpointing, 8-bit Adam, low rank.
Without step 1 the text encoders alone (T5 is ~5B) sit beside the transformer and
8 GB is hopeless.

--check runs ONE forward+backward and reports peak VRAM, so a bad configuration
fails in a minute instead of after an hour.

  python train_lora.py --check
  python train_lora.py --kit characters/seraphinne/accepted --steps 1200
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

REPO = "Freepik/flux.1-lite-8B"
TRIGGER = "seraphinne_vallora"   # rare token the identity attaches to
AI_DISCLOSURE = "AI-generated model. Not a real person."


def _free():
    import torch
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()


def _peak():
    import torch
    return torch.cuda.max_memory_allocated() / 1024**3


def _token():
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")


def cache_pass(kit: Path, cache: Path, res: int) -> int:
    """Encode images to latents and the caption to embeds, then free the encoders."""
    import torch
    from PIL import Image
    from diffusers import AutoencoderKL
    from transformers import CLIPTextModel, CLIPTokenizer, T5EncoderModel, T5TokenizerFast
    from transformers import BitsAndBytesConfig as TBnb

    cache.mkdir(parents=True, exist_ok=True)
    files = sorted([p for p in kit.glob("*.png")])
    if not files:
        print(f"no images in {kit}"); return 1
    print(f"caching {len(files)} images at {res}px")

    tok = _token()
    vae = AutoencoderKL.from_pretrained(REPO, subfolder="vae", torch_dtype=torch.bfloat16, token=tok).to("cuda")
    vae.requires_grad_(False)

    lat = []
    for f in files:
        img = Image.open(f).convert("RGB").resize((res, res), Image.LANCZOS)
        import numpy as np
        x = torch.from_numpy(np.array(img)).float().permute(2, 0, 1)[None] / 127.5 - 1.0
        with torch.no_grad():
            z = vae.encode(x.to("cuda", torch.bfloat16)).latent_dist.sample()
        z = (z - vae.config.shift_factor) * vae.config.scaling_factor
        lat.append(z.cpu())
    latents = torch.cat(lat)
    torch.save(latents, cache / "latents.pt")
    print(f"latents: {tuple(latents.shape)}")

    cfg = {"vae_scale": vae.config.scaling_factor, "vae_shift": vae.config.shift_factor,
           "res": res, "count": len(files)}
    del vae
    _free()

    # One caption for the whole kit: every image is the same person, and a single
    # embedding pair is all the training loop needs.
    caption = (f"{TRIGGER}, a beauty portrait photograph of one woman, "
               "natural skin texture, editorial beauty photography")
    ctok = CLIPTokenizer.from_pretrained(REPO, subfolder="tokenizer", token=tok)
    ctext = CLIPTextModel.from_pretrained(REPO, subfolder="text_encoder", torch_dtype=torch.bfloat16, token=tok).to("cuda")
    with torch.no_grad():
        ci = ctok(caption, padding="max_length", max_length=77, truncation=True, return_tensors="pt")
        pooled = ctext(ci.input_ids.to("cuda"), output_hidden_states=False).pooler_output
    torch.save(pooled.cpu(), cache / "pooled.pt")
    del ctext
    _free()

    tq = TBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    ttok = T5TokenizerFast.from_pretrained(REPO, subfolder="tokenizer_2", token=tok)
    t5 = T5EncoderModel.from_pretrained(REPO, subfolder="text_encoder_2",
                                        quantization_config=tq, torch_dtype=torch.bfloat16, token=tok)
    with torch.no_grad():
        ti = ttok(caption, padding="max_length", max_length=512, truncation=True, return_tensors="pt")
        emb = t5(ti.input_ids.to("cuda"))[0]
    torch.save(emb.cpu(), cache / "prompt_embeds.pt")
    print(f"prompt embeds: {tuple(emb.shape)}  pooled: {tuple(pooled.shape)}")
    del t5
    _free()

    (cache / "cache.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    print("cache pass done — VAE and both text encoders are now unloaded")
    return 0


def _transformer(rank: int):
    import torch
    from diffusers import FluxTransformer2DModel, BitsAndBytesConfig as DBnb
    from peft import LoraConfig, get_peft_model

    dq = DBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    tr = FluxTransformer2DModel.from_pretrained(
        REPO, subfolder="transformer", quantization_config=dq,
        torch_dtype=torch.bfloat16, token=_token())
    # Deliberately NOT peft.prepare_model_for_kbit_training: it is written for
    # language models and calls get_input_embeddings(), which a diffusion
    # transformer does not have. Its useful part here is just gradient
    # checkpointing, which the model exposes directly.
    tr.enable_gradient_checkpointing()
    guidance_embeds = bool(getattr(tr.config, "guidance_embeds", False))
    cfg = LoraConfig(
        r=rank, lora_alpha=rank, lora_dropout=0.0, bias="none",
        # Attention projections only. Adding the feed-forward layers roughly doubles
        # the trainable parameters for little identity gain at this scale.
        target_modules=["to_q", "to_k", "to_v", "to_out.0"],
    )
    tr = get_peft_model(tr, cfg)
    trainable = sum(p.numel() for p in tr.parameters() if p.requires_grad)
    print(f"LoRA rank {rank}: {trainable/1e6:.1f}M trainable params  guidance_embeds={guidance_embeds}")
    return tr, guidance_embeds


def _batch(latents, embeds, pooled, idx, device):
    """Pack one latent the way FluxPipeline does, and build its position ids."""
    import torch
    from diffusers import FluxPipeline
    z = latents[idx:idx + 1].to(device, torch.bfloat16)
    b, c, h, w = z.shape
    packed = FluxPipeline._pack_latents(z, b, c, h, w)
    ids = FluxPipeline._prepare_latent_image_ids(b, h // 2, w // 2, device, torch.bfloat16)
    txt_ids = torch.zeros(embeds.shape[1], 3, device=device, dtype=torch.bfloat16)
    return packed, ids, txt_ids, (h, w)


def train(kit: Path, cache: Path, out: Path, steps: int, rank: int, lr: float,
          res: int, check_only: bool) -> int:
    import torch
    from diffusers import FluxPipeline

    if not (cache / "latents.pt").exists():
        rc = cache_pass(kit, cache, res)
        if rc:
            return rc

    latents = torch.load(cache / "latents.pt")
    embeds = torch.load(cache / "prompt_embeds.pt")
    pooled = torch.load(cache / "pooled.pt")
    n = latents.shape[0]
    print(f"training set: {n} latents {tuple(latents.shape[1:])}")

    _free()
    tr, guidance_embeds = _transformer(rank)
    dev = "cuda"

    import bitsandbytes as bnb
    opt = bnb.optim.AdamW8bit([p for p in tr.parameters() if p.requires_grad], lr=lr,
                              betas=(0.9, 0.999), weight_decay=1e-4)

    emb_d = embeds.to(dev, torch.bfloat16)
    pool_d = pooled.to(dev, torch.bfloat16)
    total = 1 if check_only else steps
    t_start = time.time()
    losses = []

    for step in range(total):
        i = step % n
        packed, ids, txt_ids, _ = _batch(latents, embeds, pooled, i, dev)
        noise = torch.randn_like(packed)
        # Flow matching: sample t, interpolate, and regress the velocity.
        t = torch.sigmoid(torch.randn(1, device=dev)).to(torch.bfloat16)
        noisy = (1.0 - t) * packed + t * noise
        target = noise - packed

        guidance = torch.tensor([1.0], device=dev, dtype=torch.bfloat16) \
            if tr.config.guidance_embeds else None

        pred = tr(hidden_states=noisy,
                  timestep=t.expand(1),
                  guidance=guidance,
                  pooled_projections=pool_d,
                  encoder_hidden_states=emb_d,
                  txt_ids=txt_ids,
                  img_ids=ids,
                  return_dict=False)[0]

        loss = torch.nn.functional.mse_loss(pred.float(), target.float())
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for p in tr.parameters() if p.requires_grad], 1.0)
        opt.step()
        opt.zero_grad(set_to_none=True)
        losses.append(loss.item())

        if check_only:
            print(f"one step OK — loss {loss.item():.4f}, peak VRAM {_peak():.2f} GB")
            print("CHECK PASSED" if _peak() < 7.6 else "CHECK TIGHT — lower --res or --rank")
            return 0
        if (step + 1) % 50 == 0:
            avg = sum(losses[-50:]) / 50
            el = time.time() - t_start
            eta = el / (step + 1) * (total - step - 1)
            print(f"step {step+1}/{total}  loss {avg:.4f}  peak {_peak():.2f} GB  eta {eta/60:.0f}m")

    out.mkdir(parents=True, exist_ok=True)
    tr.save_pretrained(out / "lora")
    meta = {"trigger": TRIGGER, "base": REPO, "rank": rank, "steps": steps, "lr": lr,
            "res": res, "kit_images": n, "final_loss": round(sum(losses[-50:]) / min(50, len(losses)), 4),
            "peak_vram_gb": round(_peak(), 2), "disclosure": AI_DISCLOSURE}
    (out / "train_report.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"\nsaved {out/'lora'}  final loss {meta['final_loss']}  peak {meta['peak_vram_gb']} GB")
    print(f"trigger word: {TRIGGER}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--kit", type=Path, default=Path("characters/seraphinne/accepted"))
    p.add_argument("--cache", type=Path, default=Path("characters/seraphinne/cache"))
    p.add_argument("--out", type=Path, default=Path("characters/seraphinne"))
    p.add_argument("--steps", type=int, default=1200)
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--res", type=int, default=512)
    p.add_argument("--check", action="store_true", help="one fwd+bwd, report peak VRAM, then stop")
    a = p.parse_args()
    return train(a.kit, a.cache, a.out, a.steps, a.rank, a.lr, a.res, a.check)


if __name__ == "__main__":
    sys.exit(main())
