# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install && npm install --prefix server && npm install --prefix client

# Copy source and build
COPY . .
RUN npm run build

# ---------- production stage ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* ./
COPY server/package.json server/
RUN npm install --omit=dev && npm install --omit=dev --prefix server

# Copy compiled server
COPY --from=build /app/server/dist ./server/dist

# Copy compiled client static files
COPY --from=build /app/client/dist ./client/dist

EXPOSE 8000

# The server entrypoint
CMD ["node", "server/dist/server.js"]
