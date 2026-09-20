# The React site, built once into static files and served by nginx.
# On AWS this is the piece most likely to move to S3 + CloudFront instead;
# as a container it slots in behind the load balancer like any other service.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
