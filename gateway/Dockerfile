FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]
