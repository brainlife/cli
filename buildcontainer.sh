#!/bin/bash
set -e
set -x

docker build -t brainlife/cli .
docker tag brainlife/cli brainlife/cli:1.5.0
docker push brainlife/cli

#test 
docker run -it brainlife/cli --version
#singularity run docker://brainlife/cli login
