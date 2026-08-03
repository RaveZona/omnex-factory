# Docker on this machine — what actually matters

Not a tutorial. Every line below is a failure this project hit, what it cost, and
the rule that prevents it. An 8 GB GPU and a 238 GB disk make Docker unforgiving
in ways a 24 GB workstation never shows you.

---

## The five rules

**1. One GPU container at a time.**
Two at once is what killed the 12B model: it needed 5.5 GB and the card had 6.5 GB
free, but the other container's pipeline was still resident. There is no queue —
the second job just fails at load.

```bash
docker stop $(docker ps -q)          # before any GPU job
curl -s http://localhost:11434/api/generate \
     -d '{"model":"qwen3:8b","keep_alive":0,"prompt":""}'   # evict Ollama too
```

**2. `MSYS_NO_PATHCONV=1` in Git Bash, always.**
Git Bash rewrites anything that looks like a Unix path. `-w /work` became
`-w "C:/Program Files/Git/work"` and the container refused to start with
*"working directory is invalid"*. PowerShell does not do this; Git Bash does.

**3. Bind mounts for anything large.**
A named volume lives inside the Docker VHDX. Delete 19 GB of images and the VHDX
does **not** shrink — the space is free inside Docker and still gone from the host.
Reclaiming it needs Docker stopped and an offline compact:

```powershell
docker desktop stop; wsl --shutdown
@"
select vdisk file="D:\Docker\wsl\disk\docker_data.vhdx"
attach vdisk readonly
compact vdisk
detach vdisk
"@ | diskpart
```
That returned **50.9 GB** here — the VHDX went 69.5 GB to 18.5 GB.

**4. `docker image prune -a` deletes images you still need.**
Plain `prune` only removes dangling layers and reclaims almost nothing (448 MB
here). `-a` removes every image without a *running* container — which took out
`omnex/sd-ambassador:1` because nothing happened to be running from it. Prune with
`--filter` or by name, and rebuild recipes belong in commit messages.

**5. `docker commit` captures the running command.**
Committing a container started with `tail -f /dev/null` bakes that in as the
entrypoint: the image then reports healthy and does nothing. Reset it explicitly:

```bash
docker commit --change 'ENTRYPOINT []' --change 'CMD ["python"]' <container> <image>
```

---

## Disk traps specific to this setup

| What | Where | Note |
|---|---|---|
| Docker Scout / trivy caches | `C:\Users\PC\AppData\Local\Temp` | Every image pull leaves one. **8.4 GB** reclaimed in one sweep. |
| Model cache | `D:\OMNEX_Factory\.hfcache` | 66 GB. Bind mount, never a volume. |
| Ollama models | `D:\ollama\models` | `OLLAMA_MODELS` must be set at **Machine** scope — a User-scope value is invisible to a service already running, and 12 GB silently landed on C:. |
| E: drive | — | **Not a real disk.** A 48 TB "Msft Virtual Disk" backed by a file on a 238 GB SSD. It reports 42 TB free and accepts writes until the host disk fills, then both fail. Do not move anything there. |

---

## Why images are built, not scripted

`omnex/flux:1` carries torch, diffusers, bitsandbytes, peft, insightface and the
system libraries insightface needs. Installing those per run costs minutes each
time and fails differently when a package publishes a new version. Build once,
commit, pin the tag.

Two system-library gotchas that cost a debugging round each:
- `insightface` imports fine and then dies on `libxcb.so.1` — an OpenCV dependency
  the slim images omit. Fix: `apt-get install -y libgl1 libglib2.0-0 libxcb1`.
- TensorFlow's official `:latest-gpu` ships a **broken cuDNN**: the GPU is passed
  through, TF is built with CUDA, and no device registers. The reason only appears
  at log level 0. Fix was `pip install tensorflow[and-cuda]` — that path is now
  retired in favour of Flux, but the lesson generalises: a vendor's own GPU image
  is not automatically a working GPU image.

---

## Verifying, not assuming

A container that starts is not a container that works. Every image here has a
`--check` that runs a real kernel on the GPU and imports every library before any
weights download:

```bash
docker compose --profile gen run --rm gen --check
```

That habit came from ComfyUI: a 16.7 GB image, several restarts, and only then the
discovery that its torch segfaulted (exit 139) on this card. Seconds of checking
would have saved all of it.
