FROM node:14
RUN npm install -g brainlife@1.5.4
#CMD ["bl"]
ENTRYPOINT ["bl"]
