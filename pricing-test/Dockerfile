# Mirrors proposal step 5: ffmpeg + Shaka Packager in one image for Cloudflare Containers.
FROM debian:bookworm-slim
ARG TARGETARCH
ARG PACKAGER_VERSION=v3.9.3
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg time jq curl ca-certificates bc \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in arm64) A=arm64;; amd64) A=x64;; *) echo "unsupported arch $TARGETARCH" && exit 1;; esac \
    && curl -fsSL -o /usr/local/bin/packager \
       "https://github.com/shaka-project/shaka-packager/releases/download/${PACKAGER_VERSION}/packager-linux-${A}" \
    && chmod +x /usr/local/bin/packager && packager --version
COPY encode.sh package.sh /work/
RUN chmod +x /work/*.sh
WORKDIR /work
