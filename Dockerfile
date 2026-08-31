FROM node:20-slim

# yt-dlp 및 영상 병합에 필요한 ffmpeg 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data /app/downloads

VOLUME ["/app/data", "/app/downloads"]

ENV PORT=5050
EXPOSE 5050

CMD ["node", "server/index.js"]
