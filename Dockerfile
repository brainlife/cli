FROM node:14
RUN npm install -g brainlife@1.5.12
ENTRYPOINT ["bl"]
