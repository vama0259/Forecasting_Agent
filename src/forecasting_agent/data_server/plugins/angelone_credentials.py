# Angel One credentials container loaded from environment variables.
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AngelOneCredentials:
    # Holds immutable Angel One SmartAPI credentials.
    api_key: str
    client_code: str
    mpin: str
    totp_secret: str

    @classmethod
    def from_env(cls) -> "AngelOneCredentials":
        # Reads Angel One credentials from os.environ and returns an AngelOneCredentials instance.
        return cls(
            api_key=os.environ["ANGELONE_API_KEY"],
            client_code=os.environ["ANGELONE_CLIENT_CODE"],
            mpin=os.environ["ANGELONE_MPIN"],
            totp_secret=os.environ["ANGELONE_TOTP_SECRET"],
        )
