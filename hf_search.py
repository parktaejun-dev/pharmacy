import subprocess
import sys

try:
    from huggingface_hub import HfApi, hf_hub_download
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
    from huggingface_hub import HfApi, hf_hub_download

api = HfApi()
models = api.list_models(search="pill")
for m in models:
    if "yolo" in m.modelId.lower():
        print(f"Checking {m.modelId}")
        try:
            files = api.list_repo_files(repo_id=m.modelId)
            for f in files:
                if f.endswith(".pt") or f.endswith(".onnx"):
                    print(f"Found: {m.modelId} / {f}")
                    if f.endswith(".onnx"):
                        path = hf_hub_download(repo_id=m.modelId, filename=f, local_dir="./public/models")
                        print(f"Saved ONNX to {path}")
                        sys.exit(0)
        except Exception as e:
            pass
print("No ONNX found on HF.")
sys.exit(1)
