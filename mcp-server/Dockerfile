FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 py3-pip
COPY package*.json ./
RUN npm install
COPY requirements.txt ./
RUN python3 -m pip install --break-system-packages -r requirements.txt

FROM deps AS dev
COPY . .
EXPOSE 4100
CMD ["npm", "run", "dev:http"]
