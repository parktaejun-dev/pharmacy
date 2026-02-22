import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request("https://api.github.com/search/code?q=best.pt+in:path+pill+detection", headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        for item in data.get('items', []):
            print(item['html_url'])
            print(item['raw_url'] if 'raw_url' in item else item['url'])
except Exception as e:
    print(e)
