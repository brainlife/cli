#!/bin/bash
set -e
set -x

VERSION=$(jq -r .version package.json)

docker build --build-arg VERSION=$VERSION -t brainlife/cli .
docker tag brainlife/cli brainlife/cli:$VERSION
docker push brainlife/cli:$VERSION
docker tag brainlife/cli brainlife/cli:latest
docker push brainlife/cli:latest

docker run -it brainlife/cli --version
