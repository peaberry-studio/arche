# ══════════════════════════════════════════════════════════════════════════════
# CALIX PANEL — Rails Application
# ══════════════════════════════════════════════════════════════════════════════
# Panel web para gestión de usuarios, repos e instancias OpenCode.
# Usa SQLite + Solid Queue (sin Postgres/Redis).
# ══════════════════════════════════════════════════════════════════════════════

FROM ruby:3.3-alpine

# Dependencias de sistema
RUN apk add --no-cache \
    build-base \
    sqlite-dev \
    git \
    tzdata \
    nodejs \
    yarn

WORKDIR /app

# Copiar Gemfile primero para cachear bundle install
COPY Gemfile Gemfile.lock ./
RUN bundle config set --local deployment 'true' && \
    bundle config set --local without 'development test' && \
    bundle install

# Copiar el resto de la aplicación
COPY . .

# Precompilar assets (si hay)
RUN bundle exec rails assets:precompile 2>/dev/null || true

# Variables de entorno por defecto
ENV RAILS_ENV=production
ENV RAILS_LOG_TO_STDOUT=true
ENV RAILS_SERVE_STATIC_FILES=true

EXPOSE 3000

CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]
