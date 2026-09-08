# syntax=docker/dockerfile:1
# Worker Rust del scraper: compila en imagen rust y corre en alpine mínima.
FROM rust:1-alpine AS builder
WORKDIR /src
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /src/target/release/cv-harness-scraper /usr/local/bin/cv-harness-scraper
CMD ["cv-harness-scraper"]
