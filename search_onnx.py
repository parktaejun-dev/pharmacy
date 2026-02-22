import urllib.request
import json
import ssl
import sys
import os

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# We use the GitHub Search API for repositories
req = urllib.request.Request("https://api.github.com/search/repositories?q=pill+detection+yolo+onnx", headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        repos = data.get('items', [])
        for repo in repos:
            print(f"Checking repo: {repo['full_name']}")
            # get tree
            tree_url = f"https://api.github.com/repos/{repo['full_name']}/git/trees/{repo['default_branch']}?recursive=1"
            treq = urllib.request.Request(tree_url, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(treq, context=ctx) as tresp:
                    tdata = json.loads(tresp.read().decode())
                    for item in tdata.get('tree', []):
                        if item['path'].endswith('.onnx') and 'best' in item['path'].lower():
                            download_url = f"https://raw.githubusercontent.com/{repo['full_name']}/{repo['default_branch']}/{item['path']}"
                            print(f"Found ONNX: {download_url}")
                            # Download it!
                            urllib.request.urlretrieve(download_url, "./public/models/roboflow.onnx")
                            print("Downloaded to ./public/models/roboflow.onnx")
                            sys.exit(0)
            except Exception as e:
                print(e)
except Exception as e:
    print(e)

print("No ONNX found manually.")
sys.exit(1)
