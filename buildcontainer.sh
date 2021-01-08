#!/bin/bash
set -e
set -x

version=$(jq -r .version package.json)

docker build -t brainlife/cli .
docker tag brainlife/cli brainlife/cli:$version
docker push brainlife/cli

#test 
docker run -it brainlife/cli --version
#singularity run docker://brainlife/cli login
