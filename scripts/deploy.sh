#!/usr/bin/env bash
# Deploy Premium Watch with gcloud. Usage: scripts/deploy.sh setup|api|job|scheduler|rules|all
# Reads config/deploy.env. Run `setup` once per project.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f config/deploy.env ] || { echo "config/deploy.env is missing (copy config/deploy.env.example)"; exit 1; }
set -a; source config/deploy.env; set +a
: "${PROJECT_ID:?}" "${REGION:?}" "${SCHEDULER_REGION:=europe-west1}"

REPO="$REGION-docker.pkg.dev/$PROJECT_ID/premium-watch"
API_SA="pw-api@$PROJECT_ID.iam.gserviceaccount.com"
JOB_SA="pw-job@$PROJECT_ID.iam.gserviceaccount.com"
SCHED_SA="pw-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
SERVICE=premium-watch
JOB=premium-watch-job
TAG="$(git rev-parse --short HEAD)$(git diff --quiet || echo -dirty)"
G="gcloud --project=$PROJECT_ID --quiet"

build() { # dockerfile image
  $G builds submit --region="$REGION" --config cloudbuild.yaml --substitutions="_DOCKERFILE=$1,_IMAGE=$2" .
}

setup() {
  $G services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    cloudscheduler.googleapis.com secretmanager.googleapis.com firestore.googleapis.com \
    identitytoolkit.googleapis.com iamcredentials.googleapis.com
  $G artifacts repositories describe premium-watch --location="$REGION" >/dev/null 2>&1 ||
    $G artifacts repositories create premium-watch --repository-format=docker --location="$REGION"
  # Cloud Build runs as the default compute service account in new projects; let it read the
  # uploaded source, push images and write logs.
  local num; num=$($G projects describe "$PROJECT_ID" --format='value(projectNumber)')
  for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
    $G projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$num-compute@developer.gserviceaccount.com" --role="$role" --condition=None >/dev/null
  done
  for sa in pw-api pw-job pw-scheduler; do
    $G iam service-accounts describe "$sa@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 ||
      $G iam service-accounts create "$sa" --display-name="Premium Watch $sa"
  done
  # api: read/write Firestore, look up users (token revocation check).
  $G projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$API_SA" --role=roles/datastore.user --condition=None >/dev/null
  $G projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$API_SA" --role=roles/firebaseauth.viewer --condition=None >/dev/null
  # job: read/write Firestore; secrets are granted per secret below.
  $G projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$JOB_SA" --role=roles/datastore.user --condition=None >/dev/null
  for s in eodhd-api-key resend-api-key; do
    if $G secrets describe "$s" >/dev/null 2>&1; then
      $G secrets add-iam-policy-binding "$s" --member="serviceAccount:$JOB_SA" --role=roles/secretmanager.secretAccessor >/dev/null
    else
      echo "!! secret $s does not exist yet; create it (README > Secrets) and rerun setup"
    fi
  done
  echo "setup done"
}

deploy_api() {
  : "${OWNER_UID:?set OWNER_UID in config/deploy.env}" "${FIREBASE_API_KEY:?}"
  local image="$REPO/api:$TAG"
  build api/Dockerfile "$image"
  $G run deploy "$SERVICE" --image="$image" --region="$REGION" --service-account="$API_SA" \
    --allow-unauthenticated --min-instances=0 --max-instances=1 --cpu=1 --memory=256Mi --concurrency=40 \
    --cpu-throttling --timeout=60 \
    --set-env-vars="OWNER_UID=$OWNER_UID,FIREBASE_API_KEY=$FIREBASE_API_KEY,FIREBASE_APP_ID=${FIREBASE_APP_ID:-},GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
  echo "service URL: $($G run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
}

deploy_job() {
  : "${APP_URL:?set APP_URL in config/deploy.env (the service URL)}"
  local image="$REPO/job:$TAG"
  build job/Dockerfile "$image"
  $G run jobs deploy "$JOB" --image="$image" --region="$REGION" --service-account="$JOB_SA" \
    --tasks=1 --max-retries=1 --task-timeout=15m --cpu=1 --memory=512Mi \
    --set-secrets="EODHD_API_KEY=eodhd-api-key:latest,RESEND_API_KEY=resend-api-key:latest" \
    --set-env-vars="^|^GOOGLE_CLOUD_PROJECT=$PROJECT_ID|APP_URL=$APP_URL|MARKET_DATA_PROVIDER=${MARKET_DATA_PROVIDER:-eodhd}|MARKET_DATA_PROVIDER_TSE=${MARKET_DATA_PROVIDER_TSE:-yahoo}|FX_PROVIDER=${FX_PROVIDER:-eodhd}|CRYPTO_HISTORY_PROVIDER=${CRYPTO_HISTORY_PROVIDER:-eodhd}|SPOT_PROVIDER=coingecko|ALERT_TO=${ALERT_TO:-}|ALERT_FROM=${ALERT_FROM:-Premium Watch <onboarding@resend.dev>}|INTRADAY_ENABLED=${INTRADAY_ENABLED:-false}"
}

# One Cloud Scheduler trigger. Calls the Cloud Run Admin API (googleapis.com), which takes an
# OAuth access token; OIDC tokens are for calling a Cloud Run *service* URL directly.
trigger() { # name schedule timezone args-json
  local uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB:run"
  local body="{\"overrides\":{\"containerOverrides\":[{\"args\":$4}]}}"
  local verb=create
  $G scheduler jobs describe "$1" --location="$SCHEDULER_REGION" >/dev/null 2>&1 && verb=update
  $G scheduler jobs "$verb" http "$1" --location="$SCHEDULER_REGION" --schedule="$2" --time-zone="$3" \
    --uri="$uri" --http-method=POST --message-body="$body" --headers=Content-Type=application/json \
    --oauth-service-account-email="$SCHED_SA" --attempt-deadline=60s
}

deploy_scheduler() {
  # The scheduler identity may run the job with argument overrides, and nothing else.
  $G run jobs add-iam-policy-binding "$JOB" --region="$REGION" --member="serviceAccount:$SCHED_SA" --role=roles/run.jobsExecutorWithOverrides >/dev/null
  trigger pw-close-tokyo "0 17 * * 1-5" Asia/Tokyo '["--mode","close","--market","tokyo"]'
  trigger pw-close-us "30 18 * * 1-5" America/New_York '["--mode","close","--market","us"]'
  if [ "${INTRADAY_ENABLED:-false}" = "true" ]; then
    trigger pw-intraday-tokyo "*/30 9-15 * * 1-5" Asia/Tokyo '["--mode","intraday","--market","tokyo"]'
    trigger pw-intraday-us "*/30 9-15 * * 1-5" America/New_York '["--mode","intraday","--market","us"]'
  else
    for t in pw-intraday-tokyo pw-intraday-us; do
      $G scheduler jobs delete "$t" --location="$SCHEDULER_REGION" >/dev/null 2>&1 || true
    done
  fi
  $G scheduler jobs list --location="$SCHEDULER_REGION"
}

deploy_rules() {
  : "${OWNER_UID:?set OWNER_UID in config/deploy.env}"
  node scripts/render-rules.mjs
  npx firebase deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"
}

case "${1:-}" in
  setup) setup ;;
  api) deploy_api ;;
  job) deploy_job ;;
  scheduler) deploy_scheduler ;;
  rules) deploy_rules ;;
  all) deploy_rules; deploy_api; deploy_job; deploy_scheduler ;;
  *) echo "usage: $0 setup|api|job|scheduler|rules|all"; exit 2 ;;
esac
