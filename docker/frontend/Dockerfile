# Kept in lockstep with the backend image and CI (node >=22.12.0) so a build
# that passes here matches the runtime the rest of the stack is validated on.
FROM node:22.13.0-alpine AS builder

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
# conf.d via envsubst, so the ${INTERNAL_API_KEY} in the template is
# substituted from the runtime secret at container start.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
