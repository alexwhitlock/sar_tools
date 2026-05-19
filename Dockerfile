FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ARG GIT_HASH=unknown
ARG GIT_DATE=unknown
ARG HOST_HOSTNAME=unknown
ARG HOST_DB_PATH=unknown
RUN echo "{\"gitHash\":\"${GIT_HASH}\",\"gitDate\":\"${GIT_DATE}\",\"hostname\":\"${HOST_HOSTNAME}\",\"dbPath\":\"${HOST_DB_PATH}\"}" > /app/static/version.json
CMD ["gunicorn", "-w", "1", "-k", "gevent", "-b", "0.0.0.0:5000", "sar_tools:app"]