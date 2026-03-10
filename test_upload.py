import requests
import json

# Upload PDF to the API
with open('test.pdf', 'rb') as f:
    files = {'file': f}
    response = requests.post('http://localhost:5000/api/pdf/upload', files=files)
    print('Status Code:', response.status_code)
    print('Response:', json.dumps(response.json(), indent=2))
