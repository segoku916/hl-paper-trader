# HL Paper Trader backend — Hugging Face Spaces (Docker) deploy
# Build context is the REPO ROOT (HF builds the Dockerfile at root);
# only backend/ is copied into the image. Node 24 (native
# type-stripping, no build step). HF sets PORT=7860; the server reads
# process.env.PORT. Secrets come from Space secrets only.
FROM node:24-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
EXPOSE 7860
CMD ["npm", "start"]
