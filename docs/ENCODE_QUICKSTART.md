# Encode a film on the Ztor platform (quick guide)

After the upload, the film waits in the queue until an encoder runs. You run it, on any machine with Docker that can stay on for hours. It pulls the master from the platform; the local file is not needed.

## Needs
- Docker Desktop running
- Free disk: 3 x the master size (25 GB for a 6 GB film)
- Time: about 5 x the film length for 1080p (a 95-minute film: 6 to 8 hours)
- The `encoder` folder (zip from us) and the runner token (sent separately)

## Steps
1. Build the image once, from the folder that contains `encoder`:
   ```
   docker build -t ztor-encoder encoder
   ```
2. Start the encoder (one line):
   ```
   docker run -d --name ztor-runner -e POLL_URL=https://ztor-video.eric-tam.workers.dev -e RUNNER_TOKEN=<token> -e RUNNER_NAME=cn-team-pc -e POLL_S=10 ztor-encoder
   ```
   Bigger drive for the working files: add `-e WORK_DIR=/work/tmp -v D:\ztor-work:/work/tmp`
3. Watch it:
   ```
   docker logs -f ztor-runner
   ```
   Expect: `job <film id>` -> encode timing -> `packaged` -> `uploaded N files` -> `done -> 200`. A `FAILED` line: send us the log.
4. Check the film in a browser: `https://ztor-video.eric-tam.workers.dev/films/<FILM_ID>`  
   `status`: queued -> encoding -> packaged -> **ready**
5. When ready, stop it: `docker rm -f ztor-runner` (or leave it for the next film), and tell us the film id.
