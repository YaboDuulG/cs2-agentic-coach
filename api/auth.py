"""
Authorization dependencies for FastAPI.
"""

import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Verifies the Clerk JWT token.
    Returns the user_id from the token subject.
    """
    token = credentials.credentials

    pem_key = os.getenv("CLERK_PEM_PUBLIC_KEY")
    if not pem_key:
        expected_secret = os.getenv("API_SHARED_SECRET")
        if expected_secret and token == expected_secret:
            return "internal_service_user"
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_PEM_PUBLIC_KEY is not configured on the server."
        )

    try:
        if "-----BEGIN PUBLIC KEY-----" not in pem_key:
            pem_key = f"-----BEGIN PUBLIC KEY-----\n{pem_key}\n-----END PUBLIC KEY-----"

        payload = jwt.decode(
            token,
            pem_key,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )
        return payload.get("sub", "")
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
        )
