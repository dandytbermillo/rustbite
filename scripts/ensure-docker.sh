#!/usr/bin/env bash
set -euo pipefail

log() { printf "[ensure-docker] %s\n" "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "Docker CLI is not installed. Install Docker Desktop (macOS) or docker-engine (Linux) and retry."
  exit 1
fi

start_docker() {
  case "$(uname -s)" in
    Darwin)
      open -a Docker
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl start docker
      elif command -v service >/dev/null 2>&1; then
        sudo service docker start
      else
        return 1
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

if ! docker info >/dev/null 2>&1; then
  log "Docker daemon is not running. Starting it..."
  if ! start_docker; then
    log "Could not auto-start Docker on this OS. Start it manually and retry."
    exit 1
  fi

  # Bound the wait so a wedged daemon doesn't hang `npm run dev` forever.
  printf "[ensure-docker] Waiting for Docker daemon"
  ready=0
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      ready=1
      break
    fi
    printf "."
    sleep 1
  done
  printf "\n"

  if [ "$ready" -ne 1 ]; then
    log "Docker did not become ready within 60 seconds. Check Docker Desktop / docker.service."
    exit 1
  fi
  log "Docker is ready."
fi

log "Bringing up rushbite-db container..."
docker compose up -d

log "Database container is up."
