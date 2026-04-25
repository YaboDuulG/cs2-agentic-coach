"""
Cloud Tasks queue integration — enqueue Scout parse jobs.
Lazy-imported so CI tests work without google-cloud-tasks installed.
"""

import json
import logging
import os

logger = logging.getLogger(__name__)


def enqueue_scout_job(match_id: str, gcs_uri: str) -> None:
    """
    Create a Cloud Tasks HTTP target task that calls the Scout service.

    In LOCAL_MODE the task is skipped and the caller is expected to
    invoke the Scout service directly for testing.
    """
    if os.getenv("LOCAL_MODE", "false").lower() == "true":
        logger.info(f"LOCAL_MODE — skipping Cloud Tasks enqueue for {match_id}")
        return

    from google.cloud import tasks_v2  # noqa: PLC0415

    project = os.environ["GCP_PROJECT_ID"]
    location = os.environ["GCP_REGION"]
    queue = os.environ["CLOUD_TASKS_QUEUE"]
    scout_url = os.environ["SCOUT_SERVICE_URL"]  # Cloud Run URL of the Scout service

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)

    payload = json.dumps({"match_id": match_id, "gcs_uri": gcs_uri}).encode()

    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{scout_url}/internal/scout/parse",
            "headers": {"Content-Type": "application/json"},
            "body": payload,
            "oidc_token": {
                "service_account_email": os.environ.get("GCP_SERVICE_ACCOUNT", ""),
            },
        }
    }

    response = client.create_task(request={"parent": parent, "task": task})
    logger.info(f"Cloud Task created: {response.name} for match {match_id}")
