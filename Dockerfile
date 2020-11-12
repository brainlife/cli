FROM node:10
RUN npm install -g brainlife@1.5.2
#CMD ["bl"]
ENTRYPOINT ["bl"]
