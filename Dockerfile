FROM node:10
RUN npm install -g brainlife@1.5.1
#CMD ["bl"]
ENTRYPOINT ["bl"]
