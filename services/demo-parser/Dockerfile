FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o demo-parser .

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/demo-parser .
EXPOSE 8082
CMD ["/app/demo-parser"]
