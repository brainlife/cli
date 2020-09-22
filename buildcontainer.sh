#!/bin/bash
set -e
set -x

docker build -t brainlife/cli .
docker tag brainlife/cli brainlife/cli:1.4.6
docker push brainlife/cli


