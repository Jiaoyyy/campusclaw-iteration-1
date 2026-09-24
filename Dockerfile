FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "server.js"]
