FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["sh", "-c", "gunicorn -w 1 --threads 4 --timeout 120 --bind 0.0.0.0:${PORT} wsgi:app"]
