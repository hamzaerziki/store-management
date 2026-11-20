FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache postgresql-client
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads && chmod 777 uploads
EXPOSE 4000
CMD ["node", "src/server.js"]
