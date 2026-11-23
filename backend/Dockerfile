# HL Paper Trader backend — Koyeb / Docker deploy
# Node 24 (the server uses node's native type-stripping: no build step,
# no tsx needed at runtime). Secrets come from env vars only — never
# baked into the image.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8000
CMD ["npm", "start"]
