FROM python:3.11-slim

RUN pip install --no-cache-dir isso

WORKDIR /app
COPY isso.cfg /app/isso.cfg

CMD ["isso", "-c", "isso.cfg", "run"]
