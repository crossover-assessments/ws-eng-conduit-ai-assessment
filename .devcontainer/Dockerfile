# Debian bookworm: bullseye apt pools are drained (Debian 11 EOL), so
# `apt-get install git` 404s on bullseye-security. bookworm is supported.
FROM node:22.11.0-bookworm

RUN apt-get update && apt-get install -y git wait-for-it
RUN npm install -g npm@11.1.0

RUN node -v && npm -v 

WORKDIR /workspace

CMD ["sleep", "infinity"] 