#!/bin/bash
set -e
set -x

version=$(jq -r .version package.json)

docker build --build-arg version=$version -t brainlife/cli .
docker tag brainlife/cli brainlife/cli:$version
docker push brainlife/cli:$version
docker tag brainlife/cli brainlife/cli:latest
docker push brainlife/cli:latest

#test 
docker run -it brainlife/cli --version
#singularity run docker://brainlife/cli login
