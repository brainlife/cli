FROM node:14
ARG version
RUN npm install -g brainlife@$version
ENTRYPOINT ["bl"]
