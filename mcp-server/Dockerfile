FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS dev
COPY . .
EXPOSE 4100
CMD ["npm", "run", "dev:http"]
