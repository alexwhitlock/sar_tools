# db/errors.py


class ConflictError(Exception):
    """Raised when an optimistic lock check fails — another user modified the record first."""
    pass
