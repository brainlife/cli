FROM node:10

#ADD . /cli
#RUN npm install /cli && rm /cli

RUN npm install -g brainlife@1.4.6
ENTRYPOINT bl
