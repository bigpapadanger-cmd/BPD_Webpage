
LAYOUT_VERSION = "layout-v3.2-fixed-expanded-name-mvp-distance"


COLUMN_NAME_LEFT = 0.065
COLUMN_NAME_RIGHT = 0.392
COLUMN_TITLE_RIGHT = 0.300
COLUMN_PARTY_ICON_SEARCH_RATIO = 0.240
COLUMN_MVP_ICON_SEARCH_RATIO = 0.220
IDENTITY_ICON_PADDING_RATIO = 0.012

# Identity icon exclusion. These refine the actual OCR coordinate reference so
# party/MVP icons are outside the username/title crop rather than relying on OCR
# preprocessing to ignore them.
IDENTITY_PARTY_ICON_EXCLUDE_ENABLED = True
IDENTITY_PARTY_ICON_HUE_MIN = 28
IDENTITY_PARTY_ICON_HUE_MAX = 58
IDENTITY_PARTY_ICON_SAT_MIN = 70
IDENTITY_PARTY_ICON_VALUE_MIN = 50
IDENTITY_PARTY_ICON_MIN_AREA_RATIO = 0.00035
IDENTITY_PARTY_ICON_MAX_AREA_RATIO = 0.1800

IDENTITY_MVP_ICON_EXCLUDE_ENABLED = True
IDENTITY_MVP_ICON_HUE_MIN = 5
IDENTITY_MVP_ICON_HUE_MAX = 42
IDENTITY_MVP_ICON_SAT_MIN = 65
IDENTITY_MVP_ICON_VALUE_MIN = 125
IDENTITY_MVP_ICON_MIN_AREA_RATIO = 0.00025
IDENTITY_MVP_ICON_MAX_AREA_RATIO = 0.180

IDENTITY_ICON_EDGE_PAD_RATIO = 0.010
IDENTITY_ICON_EDGE_PAD_MIN_PX = 3

# Relative identity geometry.
# Party icon is predicted by mirroring SAVES around SCORE:
#     party_x = SCORE - (SAVES - SCORE)
# MVP icon is predicted by mirroring GOALS around SCORE:
#     mvp_x = SCORE - (GOALS - SCORE)
# Color detection only confirms an icon inside a narrow window around that target.
IDENTITY_ICON_SEARCH_HALF_SPACING_RATIO = 0.25
IDENTITY_PARTY_ICON_SEARCH_HALF_SPACING_RATIO = 0.42
IDENTITY_MVP_ICON_SEARCH_HALF_SPACING_RATIO = 0.52
IDENTITY_MVP_ICON_MAX_WIDTH_SPACING_RATIO = 0.52
IDENTITY_PARTY_ICON_MAX_WIDTH_SPACING_RATIO = 0.34
IDENTITY_ICON_SEARCH_MIN_HALF_PX = 8
IDENTITY_MVP_MAX_TARGET_DISTANCE_SPACING_RATIO = 0.24
IDENTITY_MVP_MIN_SIZE_SPACING_RATIO = 0.18
# Party is searched from the far-left side of the name column rather than from
# a mirrored stat position in the middle of the username.
IDENTITY_PARTY_TARGET_NAME_RATIO = 0.10

# MVP sits slightly right of the exact SCORE/GOALS mirror point.
# Express the correction in stat-column spacing so it scales with the scoreboard.
IDENTITY_MVP_TARGET_RIGHT_SHIFT_RATIO = 0.35
IDENTITY_MVP_MIN_NUMBER_BAND_RATIO = 0.75
# Lightweight title-presence test. No OCR call is used here.
# The lower identity band is background-subtracted first; title presence requires
# multiple compact glyph-like components rather than generic row contrast.
IDENTITY_TITLE_PROBE_TOP_INSET_RATIO = 0.18
IDENTITY_TITLE_PROBE_BOTTOM_INSET_RATIO = 0.06
IDENTITY_TITLE_RESIDUAL_THRESHOLD = 18
IDENTITY_TITLE_MIN_GLYPH_COMPONENTS = 3
IDENTITY_TITLE_MIN_GLYPH_HEIGHT_RATIO = 0.24
IDENTITY_TITLE_MAX_GLYPH_HEIGHT_RATIO = 0.95
IDENTITY_TITLE_MAX_GLYPH_WIDTH_RATIO = 0.30
IDENTITY_TITLE_MIN_GLYPH_AREA_PX = 4
IDENTITY_TITLE_MIN_FOREGROUND_RATIO = 0.008

# When no title is visually present, the username is vertically centered on the
# same physical row baseline as the numeric stats.
IDENTITY_NO_TITLE_USERNAME_HALF_HEIGHT_RATIO = 0.16
IDENTITY_NO_TITLE_USERNAME_MIN_HALF_PX = 7

# Player-name vertical selection. Probe the top and bottom thirds of the row
# around the shared PING/stat baseline. An empty lower third means the username
# is centered; text in both thirds means the name occupies the upper half.
IDENTITY_ROW_HALF_HEIGHT_RATIO = 0.475
IDENTITY_CENTER_USERNAME_HALF_HEIGHT_RATIO = 0.175

# Lightweight text-line detection over the complete identity area (the blue
# area in the debug example). It detects one or two horizontal text lines but
# never OCRs or returns the lower line as a title.
IDENTITY_TEXT_LINE_RESIDUAL_THRESHOLD = 12
IDENTITY_TEXT_LINE_MIN_COMPONENTS = 3
IDENTITY_TEXT_LINE_MIN_HEIGHT_SPACING_RATIO = 0.07
IDENTITY_TEXT_LINE_MAX_HEIGHT_SPACING_RATIO = 0.42
IDENTITY_TEXT_LINE_MAX_COMPONENT_WIDTH_RATIO = 0.22
IDENTITY_TEXT_LINE_MIN_SPAN_RATIO = 0.10
IDENTITY_TEXT_LINE_CLUSTER_GAP_SPACING_RATIO = 0.10
IDENTITY_TEXT_LINE_CROP_PAD_SPACING_RATIO = 0.08

SHOTS_CELL_INNER_SHRINK_RATIO = 0.075
SHOTS_CELL_X_SHIFT_RATIO = 0

COLUMN_SCORE_LEFT = 0.432
COLUMN_SCORE_RIGHT = 0.542
COLUMN_GOALS_LEFT = 0.517
COLUMN_GOALS_RIGHT = 0.632
COLUMN_MIDDLE_LEFT = 0.607
COLUMN_MIDDLE_RIGHT = 0.732
COLUMN_SAVES_LEFT = 0.707
COLUMN_SAVES_RIGHT = 0.832
COLUMN_SHOTS_LEFT = 0.807
COLUMN_SHOTS_RIGHT = 0.922
COLUMN_PING_LEFT = 0.925
COLUMN_PING_RIGHT = 0.995

# Vertical geometry is resolved from the physical player-row anchor.  These are
# fallbacks only; a direct stat-region or ping-region is preferred.
ROW_NUMERIC_FALLBACK_HALF_RATIO = 0.18
ROW_NUMERIC_MIN_HALF_PX = 16
ROW_STAT_REGION_PAD_RATIO = 0.30
ROW_STAT_REGION_MIN_PAD_PX = 5
# Extra vertical padding for inferred/faded numeric fields.
# Applied above and below score, goals, assists, saves, shots, and ping.
IDENTITY_INFERRED_NUMERIC_EXTRA_PAD_RATIO = 0.025
ROW_USERNAME_TOP_RATIO = 0.65
ROW_USERNAME_BOTTOM_RATIO = 0.045
IDENTITY_USERNAME_NUMBER_BAND_PAD_RATIO = 0.15
ROW_TITLE_TOP_RATIO = 0.10
ROW_TITLE_BOTTOM_RATIO = 0.25

# Numeric X isolation. Header-fitted centers are authoritative; adjacent-column
# midpoints form hard non-overlapping cell boundaries. A small inner gutter keeps
# anti-aliased pixels from neighboring stats out of each OCR crop.
NUMERIC_CELL_INNER_GUTTER_RATIO = 0.05
NUMERIC_CELL_MIN_GUTTER_PX = 4
NUMERIC_CELL_MIN_WIDTH_PX = 34
# SCORE / MIDDLE_STAT / PING now define the physical horizontal frame.
# Their derived column centers are already the intended value centers, so the
# old compensating left/right shifts are disabled. Keep this map as an explicit
# per-field tuning hook if a later regression proves a small correction is needed.
STAT_VALUE_LEFT_SHIFT_RATIOS = {
    "score": 0.00,
    "goals": 0.00,
    "middle": 0.00,
    "saves": -0.05,
    "shots": -0.1,
    "ping": 0.00,
}
# Identity X refinement. The canonical name region includes rank/avatar UI; OCR
# should begin to the right of that icon area while retaining clan tags.
IDENTITY_TEXT_LEFT_INSET_RATIO = 0.15
IDENTITY_TEXT_LEFT_EXTRA_SHIFT_SPACING_RATIO = 0.08
IDENTITY_FIXED_USERNAME_TOP_RATIO = 0.5
IDENTITY_FIXED_USERNAME_BOTTOM_RATIO = 0.24
# Extra space above inferred/faded player names.
# 0.08 adds about 4 px when row spacing is 54 px.
IDENTITY_INFERRED_USERNAME_TOP_EXTRA_RATIO = 0.08

IDENTITY_TEXT_RIGHT_GAP_RATIO = 0.1
IDENTITY_TITLE_RIGHT_SHRINK_RATIO = 0.1
# Direct ping anchors are stronger than generic header geometry for the right-most
# stat. Keep a modest padding so the bars + full number remain visible.
PING_DIRECT_PAD_X_RATIO = 0.10
PING_DIRECT_PAD_Y_RATIO = 0.10
PING_DIRECT_MIN_PAD_X_PX = 4
PING_DIRECT_MIN_PAD_Y_PX = 3

NUMBER_LIMITS = {
    "score": (0, 99999),
    "goals": (0, 999),
    "assists": (0, 999),
    "demos": (0, 999),
    "saves": (0, 999),
    "shots": (0, 999),
    "ping": (0, 999),
}

CANONICAL_HEADER_ORDER = (
    "SCORE",
    "GOALS",
    "MIDDLE_STAT",
    "SAVES",
    "SHOTS",
    "PING",
)

REPORT_FIELDS = (
    "score",
    "goals",
    "assists",
    "demos",
    "saves",
    "shots",
)

INFORMATIONAL_FIELDS = ("ping",)

NUMERIC_FIELD_ORDER = (
    "score",
    "goals",
    "middle",
    "saves",
    "shots",
    "ping",
)
