FROM node:22-bookworm-slim
WORKDIR /opt/remy/hub/runtime
COPY hub/runtime/package*.json ./
RUN npm ci
COPY hub/runtime/src ./src
ENV REMY_RUNTIME_BIND=0.0.0.0
EXPOSE 8788
CMD ["npm","start"]
