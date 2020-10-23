FROM node:10
RUN npm install -g brainlife@1.4.8
ENTRYPOINT bl
