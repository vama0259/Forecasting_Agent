"""Exception types raised by the evaluation package."""


class DegenerateBaselineError(Exception):
    """Raised when a MASE denominator is non-finite or exactly zero, so the scale is undefined."""
