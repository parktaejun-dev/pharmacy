import subprocess
import sys

try:
    from huggingface_hub import HfApi, hf_hub_download
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
    from huggingface_hub import HfApi, hf_hub_download

api = HfApi()
# Search more broadly
models = api.list_models(search="pill detection")
models_list = list(models)
print(f"Found {len(models_list)} models for 'pill detection'")

for m in models_list:
    try:
        files = api.list_repo_files(repo_id=m.modelId)
        for f in files:
            if f.endswith(".onnx"):
                print(f"Found ONNX: {m.modelId} / {f}")
                path = hf_hub_download(repo_id=m.modelId, filename=f, local_dir="./public/models")
                print(f"Saved to {path}")
                sys.exit(0)
    except Exception as e:
        pass

print("No ONNX models found for 'pill detection'.")
