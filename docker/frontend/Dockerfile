FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

ARG VITE_API_URL=/api
ARG VITE_WS_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY . .
RUN npm run build

FROM nginx:1.26-alpine

RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html
# The stock nginx entrypoint renders /etc/nginx/templates/*.template into
# conf.d via envsubst; 15-internal-key-header.sh (runs before it, scripts
# execute in name order) exports the header directive from the runtime
# INTERNAL_API_KEY secret.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.d/15-internal-key-header.sh /docker-entrypoint.d/15-internal-key-header.sh
RUN chmod +x /docker-entrypoint.d/15-internal-key-header.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
