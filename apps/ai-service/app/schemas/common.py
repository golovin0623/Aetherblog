from __future__ import annotations

from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """
    Matched with Java AiResponse structure.
    """
    success: bool = True
    data: Optional[T] = None
    errorCode: Optional[str] = None
    errorMessage: Optional[str] = None
    requestId: Optional[str] = None
