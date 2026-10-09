# Proposal step 5: one image with ffmpeg + Shaka Packager + a tiny Node HTTP server.
# Phase A: runs on a laptop in POLL mode. Phase B: same image on Cloudflare Containers (standard-4).
FROM debian:bookworm-slim
ARG TARGETARCH
ARG PACKAGER_VERSION=v3.9.3
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg time curl ca-certificates python3 nodejs \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in arm64) A=arm64;; amd64) A=x64;; *) echo "unsupported arch $TARGETARCH" && exit 1;; esac \
    && curl -fsSL -o /usr/local/bin/packager \
       "https://github.com/shaka-project/shaka-packager/releases/download/${PACKAGER_VERSION}/packager-linux-${A}" \
    && chmod +x /usr/local/bin/packager && packager --version
WORKDIR /work
COPY encode.sh package.sh package_clear.sh server.mjs /work/
RUN chmod +x /work/*.sh
ENV PORT=8080 WORK_DIR=/tmp/ztor
EXPOSE 8080
CMD ["node", "/work/server.mjs"]
