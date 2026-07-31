"""
Local Stable Diffusion via KerasCV — the path ComfyUI failed on.

Why this exists: ComfyUI's torch build segfaults on this machine (exit 139, even
with --gpus all), so the local-generation goal died there. TensorFlow is a
completely different runtime, so the failure does not carry over.

What it unlocks that the hosted free provider cannot:
  * a REAL denoise strength — the hosted one returns byte-identical output at
    0.35 and 0.55, which is why the Fidelity control is currently hidden
  * a REAL negative prompt — the hosted one has none, so exclusions have to be
    phrased positively and often fail
  * unmetered generation on hardware already owned

Run inside the GPU container:
  docker run --rm --gpus all -v D:/OMNEX_Factory/packs:/work -w /work \
      tensorflow/tensorflow:latest-gpu python keras_sd.py --check
  ... then without --check to generate.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

# Keep TF quiet enough that a real error is visible among the startup noise.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


def check() -> int:
    """Verify the GPU is actually usable before anything long-running starts.

    ComfyUI wasted a 16 GB download and several restarts because nothing checked
    whether torch could even import. This fails in seconds instead.
    """
    import tensorflow as tf

    print(f"TF {tf.__version__}")
    gpus = tf.config.list_physical_devices("GPU")
    if not gpus:
        print("GPU: NOT VISIBLE — this image is CPU-only, or --gpus all was omitted")
        return 1
    print(f"GPU: {[g.name for g in gpus]}")

    # Visibility is not usability: a device can be listed and still fail to run a
    # kernel. Force one real computation on it.
    with tf.device("/GPU:0"):
        a = tf.random.normal((2048, 2048))
        t0 = time.time()
        _ = tf.matmul(a, a).numpy()
        print(f"GPU matmul 2048x2048: {(time.time() - t0) * 1000:.0f} ms — usable")

    try:
        import keras_cv  # noqa: F401
        print("keras_cv: installed")
    except ImportError:
        print("keras_cv: MISSING — install with: pip install keras-cv")
        return 2
    return 0


def generate(prompt: str, negative: str, out: str, steps: int, seed: int, img_size: int = 512) -> int:
    import keras
    import keras_cv
    import tensorflow as tf
    from PIL import Image

    gpus = tf.config.list_physical_devices("GPU")
    if not gpus:
        print("Refusing to run on CPU — a single image would take many minutes.")
        return 1

    # 8 GB VRAM: let TF grow memory instead of grabbing all of it, otherwise the
    # model allocation and the sampler compete and the process dies on OOM.
    for g in gpus:
        tf.config.experimental.set_memory_growth(g, True)

    # Measured failure this is fixing: at float32 the VAE decoder's final
    # convolution is [1, 256, 512, 512], and cuDNN answers "No valid config
    # found" — it cannot fit an algorithm in the ~5.5 GB TF was given. Diffusion
    # itself completed; only the decode died. Half precision halves those
    # activations and is what makes 512x512 fit on 8 GB at all.
    keras.mixed_precision.set_global_policy("mixed_float16")
    print("precision: mixed_float16")

    print("loading model (first run downloads weights, ~4 GB)...")
    t0 = time.time()
    model = keras_cv.models.StableDiffusion(img_width=img_size, img_height=img_size, jit_compile=False)
    print(f"model ready in {time.time() - t0:.0f}s")

    tf.random.set_seed(seed)
    t0 = time.time()
    images = model.text_to_image(
        prompt,
        negative_prompt=negative or None,
        batch_size=1,
        num_steps=steps,
        seed=seed,
    )
    print(f"generated in {time.time() - t0:.0f}s")

    Image.fromarray(images[0]).save(out)
    print(f"saved: {out}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="verify GPU + keras_cv, generate nothing")
    p.add_argument("--prompt", default=(
        "professional product photography background, empty polished white marble podium, "
        "soft diffused daylight, warm neutral background, centered empty space, photorealistic"
    ))
    p.add_argument("--negative", default="text, watermark, people, hands, clutter, blurry")
    p.add_argument("--out", default="keras-test.png")
    p.add_argument("--steps", type=int, default=30)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--size", type=int, default=512, help="512 fits 8 GB at fp16; drop to 384 if it still OOMs")
    a = p.parse_args()

    if a.check:
        return check()
    return generate(a.prompt, a.negative, a.out, a.steps, a.seed, a.size)


if __name__ == "__main__":
    sys.exit(main())
