FROM composer:2 AS vendor

WORKDIR /app

COPY composer.json ./

RUN composer install \
    --no-dev \
    --prefer-dist \
    --no-interaction \
    --optimize-autoloader

FROM php:8.2-cli

WORKDIR /var/www/html

RUN apt-get update && apt-get install -y --no-install-recommends \
    libzip-dev \
    unzip \
    && docker-php-ext-install mysqli \
    && rm -rf /var/lib/apt/lists/*

COPY --from=vendor /app/vendor /var/www/html/vendor
COPY . /var/www/html

RUN mkdir -p /var/www/html/uploads /var/www/html/videos /var/www/seed_uploads \
    && cp -R /var/www/html/uploads/. /var/www/seed_uploads/ 2>/dev/null; true

RUN chmod +x /var/www/html/.docker/start-railway.sh

EXPOSE 8080

CMD ["/var/www/html/.docker/start-railway.sh"]
