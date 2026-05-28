"""
Authorization dependencies for FastAPI.
"""

import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()


def verify_shared_secret(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Verifies that the provided Bearer token matches the API_SHARED_SECRET.
    This ensures only our Next.js frontend (or authorized services) can call these endpoints.
    """
    expected_secret = os.getenv("API_SHARED_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API_SHARED_SECRET is not configured on the server.",
        )

    if credentials.credentials != expected_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API shared secret.",
        )
    return credentials.credentials
