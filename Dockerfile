FROM composer:2 AS vendor

WORKDIR /app

COPY composer.json ./

RUN composer install \
    --no-dev \
    --prefer-dist \
    --no-interaction \
    --optimize-autoloader

FROM php:8.2-apache

WORKDIR /var/www/html

RUN apt-get update && apt-get install -y --no-install-recommends \
    libzip-dev \
    unzip \
    && docker-php-ext-install mysqli \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

COPY .docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY --from=vendor /app/vendor /var/www/html/vendor
COPY . /var/www/html

RUN mkdir -p /var/www/html/uploads /var/www/html/videos \
    && chown -R www-data:www-data /var/www/html/uploads /var/www/html/videos

EXPOSE 80
