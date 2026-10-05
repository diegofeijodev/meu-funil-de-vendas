FROM node:22-alpine
# ffmpeg do sistema para a conversão de vídeos e os quadros do crítico (o ffmpeg-static das dependências fica de reserva).
RUN apk add --no-cache ffmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3015
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
