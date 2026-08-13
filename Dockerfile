# Static PWA served by nginx. The Vite bundle is built in CI/locally and shipped in `dist/`,
# so the image build stays tiny and avoids native dev dependencies.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 80
