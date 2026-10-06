FROM node:22-alpine
# ffmpeg do sistema para a conversão de vídeos e os quadros do crítico (o ffmpeg-static das dependências fica de reserva).
# openssl: o engine do Prisma 5 no Alpine não detecta a libssl sem ele (migrate deploy morre no boot).
RUN apk add --no-cache ffmpeg openssl
ENV FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Teto de heap no build: no EC2 (dividido com o Freela) o tsc falha com mensagem clara em vez de empurrar a máquina para o swap.
RUN npx prisma generate && NODE_OPTIONS=--max-old-space-size=1536 npm run build
EXPOSE 3015
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
