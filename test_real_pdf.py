import requests
import json

# Upload the real PDF to the API
pdf_path = r"C:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"

try:
    with open(pdf_path, 'rb') as f:
        files = {'file': f}
        # Increase timeout for large file upload
        response = requests.post('http://localhost:5000/api/pdf/upload', files=files, timeout=3600)
        print('Status Code:', response.status_code)
        print('Response:', json.dumps(response.json(), indent=2))
except FileNotFoundError:
    print(f"PDF file not found: {pdf_path}")
except Exception as e:
    print(f"Error: {e}")

