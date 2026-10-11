FROM node:24-alpine AS builder

WORKDIR /app

ARG VCS_REF=local
ARG STACK_VERSION=local
ARG REQUIRE_COMMIT_NAME=false
# 官方构建标记（dev/build/buildIdentity.mjs）：只有本仓库的 docker-stack-publish workflow 会传入这两个值，
# 自己 docker build 出来的镜像默认是非官方构建。
ARG GITHUB_ACTIONS=false
ARG GITHUB_REPOSITORY=
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
ENV VITE_NETEASE_API_BASE=/netease
ENV VITE_KUGOU_API_BASE=/kugou
ENV VITE_QQ_API_BASE=/qq
ENV VITE_AI_PROVIDER=google
ENV VERCEL_GIT_COMMIT_SHA=${VCS_REF}
ENV VERCEL_GIT_COMMIT_REF=docker
ENV APP_VERSION_LABEL=Docker
ENV APP_RELEASE_CHANNEL=docker
ENV DOCKER_STACK_VERSION=${STACK_VERSION}
ENV REQUIRE_COMMIT_NAME=${REQUIRE_COMMIT_NAME}
ENV GITHUB_ACTIONS=${GITHUB_ACTIONS}
ENV GITHUB_REPOSITORY=${GITHUB_REPOSITORY}
RUN npm exec vite build

FROM nginx:1.29-alpine AS runner

RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/docker/gateway/nginx.conf.template /etc/nginx/nginx.conf.template
COPY deploy/docker/gateway/entrypoint.sh /usr/local/bin/folia-gateway
RUN chmod 0555 /usr/local/bin/folia-gateway

USER nginx
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/folia-gateway"]
