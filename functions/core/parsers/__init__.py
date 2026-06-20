"""Parser registry.

Add a new institution by writing a parser and registering it here. ``get_parser``
falls back to the generic column-mapping parser, so an unknown bank still imports.
"""
from __future__ import annotations

from .base import BaseParser
from .generic import GenericCsvParser
from .homeloan import HomeLoanParser
from .nedbank import NedbankParser

# Keys are lowercase institution slugs used by the API.
_REGISTRY: dict[str, type[BaseParser]] = {
    "generic": GenericCsvParser,
    "nedbank": NedbankParser,
    "homeloan": HomeLoanParser,
    # Roadmap - each is just another subclass:
    #   "fnb": FnbParser,
    #   "capitec": CapitecParser,
    #   "discovery": DiscoveryParser,
    #   "easyequities": EasyEquitiesParser,
}


def get_parser(institution: str | None) -> BaseParser:
    slug = (institution or "generic").strip().lower()
    parser_cls = _REGISTRY.get(slug, GenericCsvParser)
    return parser_cls()


def list_institutions() -> list[str]:
    return sorted(_REGISTRY.keys())


__all__ = ["get_parser", "list_institutions", "BaseParser"]
