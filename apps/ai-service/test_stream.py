
import requests

url = "http://localhost:8000/api/v1/ai/tags/stream"
headers = {
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiQURNSU4iLCJ1c2VybmFtZSI6ImFkbWluIiwic3ViIjoiMSIsImlhdCI6MTc2OTg2OTk1OSwiZXhwIjoxNzY5OTU2MzU5fQ.cLmtc94Q8J3MLDB3wTnqrdsOxjWbDiw3t1agHD1iJ8w",
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
}
data = {
    "content": "AI模型商 " * 2,
    "maxTags": 5,
    "modelId": "gemini-2.5-flash", 
    "providerCode": "openai_compat"
}

print(f"Connecting to {url}...")
try:
    with requests.post(url, json=data, headers=headers, stream=True) as r:
        print(f"Status: {r.status_code}")
        for line in r.iter_lines():
            if line:
                print(line.decode('utf-8')[:50])
except Exception as e:
    print(f"Error: {e}")
