# Observation archive exceptions.


class ArchiveWriteError(Exception):
    # Raised when filesystem or index write fails for an observation.
    pass


class SourceUnavailableError(Exception):
    # Raised when an observation source confirms resource is absent (e.g. 404).
    pass
