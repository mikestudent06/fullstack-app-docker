FROM node:22-alpine

RUN addgroup app && adduser -S -G app app
WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN chown -R app:app /app
USER app

EXPOSE 5173

CMD ["npm", "run", "dev"]
