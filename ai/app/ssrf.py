"""Outbound address guard for camera sources fetched by this worker.

``/capture`` dereferences a caller-supplied source through
``cv2.VideoCapture``/FFMPEG, which is a network open primitive: a source
pointed at loopback or the cloud metadata endpoint turns the worker into a
proxy for addresses the caller cannot reach directly.

The backend applies the equivalent guard before it forwards a source
(``backend/src/utils/ssrf.ts``), and this module mirrors it. The duplication
is deliberate. The worker is the component that actually opens the socket, it
holds a different trust boundary from the Node process, and the internal-key
guard only establishes that the caller is another VigiLens component -- not
that the string being fetched is safe. A guard that exists in exactly one
place is a guard that a future caller can route around.

Blocked: loopback, link-local (including the 169.254.169.254 and
``fd00:ec2::254`` metadata endpoints), unique-local, and the well-known
metadata hostnames. RFC1918 space stays reachable because on-prem cameras
live there and blocking it would break the primary deployment.
"""

import ipaddress
import socket
from urllib.parse import urlsplit

#: Hostnames that are never a camera and always an SSRF target.
BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "metadata",
        "metadata.google.internal",
        "instance-data",
        "instance-data.ec2.internal",
    }
)

#: Schemes this worker will hand to OpenCV as a network stream.
_NETWORK_SCHEMES = frozenset({"http", "https", "rtsp", "rtsps", "rtmp"})


def _is_blocked_ip(host: str) -> bool:
    """True when a literal IP is one of the always-an-attack ranges."""
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(
        addr.is_loopback
        or addr.is_link_local
        or addr.is_unspecified
        or addr.is_reserved
        or addr.is_multicast
        # IPv6 unique-local (fd00::/8) carries the EC2 IMDSv6 endpoint at
        # fd00:ec2::254.
        or (addr.version == 6 and addr in ipaddress.ip_network("fc00::/7"))
    )


def assert_source_allowed(source: str) -> None:
    """Raise :class:`ValueError` when ``source`` must not be dereferenced.

    Only network schemes are judged. ``usb`` and ``video_file`` sources are
    local device and filesystem paths, and callers are expected to route them
    around this function -- see :func:`is_network_source`.
    """
    parts = urlsplit(source)
    scheme = parts.scheme.lower()

    if not scheme:
        # A bare path or device node. Not a network destination.
        return

    if scheme not in _NETWORK_SCHEMES:
        raise ValueError(f"Unsupported camera source scheme '{parts.scheme}'")

    host = (parts.hostname or "").lower()
    if not host:
        raise ValueError("Camera source has no host")

    if host in BLOCKED_HOSTNAMES:
        raise ValueError(f"Camera source host '{host}' is not permitted")

    if _is_blocked_ip(host):
        raise ValueError(f"Camera source resolves to a blocked address ({host})")

    # Resolve before connecting so a public hostname pointing at an internal
    # address is refused too. Without this the literal-IP check above is
    # trivially bypassed by a hostname, and ``127.0.0.1.nip.io``-style rebinding
    # reaches the same place.
    #
    # A host that does not resolve is allowed through rather than refused: the
    # resolution above is only a pre-filter, and ``cv2.VideoCapture`` will fail
    # the open on its own. Treating it as blocked would turn every transient DNS
    # fault inside the container into a hard capture failure with a misleading
    # reason, for no security gain.
    try:
        infos = socket.getaddrinfo(host, parts.port or None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return

    for info in infos:
        address = info[4][0]
        if _is_blocked_ip(str(address).split("%")[0]):
            raise ValueError(
                f"Camera source host '{host}' resolves to a blocked address ({address})"
            )


def is_network_source(camera_type: str, source: str) -> bool:
    """True when this source is a network destination the guard applies to.

    ``usb`` and ``video_file`` are local by definition; every other camera
    type is treated as a network source, matching how ``open_capture`` decides
    whether to apply its network timeouts.
    """
    if camera_type in ("usb", "video_file"):
        return False
    if str(source).startswith(("rtsp://", "rtmp://", "http://", "https://")):
        return True
    return camera_type in ("rtsp", "ip")