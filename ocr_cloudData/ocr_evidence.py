"""Reusable structural evidence and the immutable post-foundation coordinate map."""

from dataclasses import dataclass, field
from typing import Any

EVIDENCE_VERSION = "evidence-v2.0-foundation-coordinate-map"


@dataclass
class ScoreboardEvidence:
    players_per_team: int
    expected_names: list = field(default_factory=list)
    image: Any = None
    coordinate_space: str = "unknown"

    header_rows: list = field(default_factory=list)
    header_summary: dict = field(default_factory=dict)
    color_candidate: dict | None = None
    foundation_rows: list = field(default_factory=list)
    foundation: dict | None = None

    raw_stat_regions: list = field(default_factory=list)
    ping_regions: list = field(default_factory=list)
    stat_regions: list = field(default_factory=list)
    row_anchors: list = field(default_factory=list)
    team_structure: dict = field(default_factory=dict)
    column_geometry: dict = field(default_factory=dict)

    normalize_scale: float = 1.0
    alignment_info: dict = field(default_factory=dict)

    computed: set = field(default_factory=set)
    compute_counts: dict = field(default_factory=dict)

    @property
    def expected_players(self):
        return int(self.players_per_team) * 2

    def mark(self, key):
        key = str(key)
        self.computed.add(key)
        self.compute_counts[key] = int(self.compute_counts.get(key, 0)) + 1

    def has(self, key):
        return str(key) in self.computed

    def set_value(self, key, value):
        setattr(self, key, value)
        self.mark(key)
        return value

    def prepared_data(self):
        """The only structural contract allowed to cross into OCR stages."""
        return {
            "foundationPassed": bool(self.foundation is not None or self.alignment_info),
            "expectedPlayers": self.expected_players,
            "expectedNames": list(self.expected_names or []),
            "pingRegions": list(self.ping_regions or []),
            "statRegions": list(self.stat_regions or []),
            "rowAnchors": list(self.row_anchors or []),
            "middleStat": self.header_summary.get("middleStat"),
            "headerVariation1": self.header_summary.get("variation1", ""),
            "headerVariation2": self.header_summary.get("variation2", ""),
            "headerRows": list(self.header_rows or []),
            "teamStructure": dict(self.team_structure or {}),
            "columnGeometry": dict(self.column_geometry or {}),
            "autoAlignment": dict(self.alignment_info or {}),
            "evidenceReuse": {
                "coordinateSpace": self.coordinate_space,
                "computed": sorted(self.computed),
                "computeCounts": dict(self.compute_counts),
            },
        }
