FROM node:14-slim
ARG VERSION
RUN npm install -g brainlife@$VERSION

RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["bl"]
