import urllib.request
from html.parser import HTMLParser
import ssl
import sys

class MLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.onnx_links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value.endswith(".onnx"):
                    self.onnx_links.append(value)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request("https://github.com/GkcA/YOLO-model-for-pills-detection/tree/main", headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        html = response.read().decode('utf-8')
        parser = MLParser()
        parser.feed(html)
        if parser.onnx_links:
            for link in parser.onnx_links:
                # build raw URL
                # link is like /GkcA/YOLO-model-for-pills-detection/blob/main/best_model.onnx
                raw_url = "https://raw.githubusercontent.com" + link.replace("/blob/", "/")
                print("Downloading from:", raw_url)
                urllib.request.urlretrieve(raw_url, "./public/models/roboflow.onnx")
                print("Downloaded successfully!")
                sys.exit(0)
        else:
            print("No ONNX links found in the tree.")
except Exception as e:
    print("Error:", e)

