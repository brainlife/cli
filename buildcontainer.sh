#!/bin/bash
set -e
set -x

docker build -t brainlife/cli .
docker tag brainlife/cli brainlife/cli:1.4.8
docker push brainlife/cli

#test 
docker run -it brainlife/cli -h
#singularity run docker://brainlife/cli login
