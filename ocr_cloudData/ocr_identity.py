from difflib import SequenceMatcher
from itertools import permutations

from ocr_text import normalize_name_for_match, uppercase_text


IDENTITY_VERSION = "identity-v1.1-shared-roster-contract"


def normalize_expected_names(expected_player_names):
    normalized = []
    seen = set()

    for item in expected_player_names or []:
        if isinstance(item, dict):
            value = (
                item.get("epic")
                or item.get("epicName")
                or item.get("username")
                or item.get("name")
                or item.get("gamerName")
                or item.get("playerName")
                or ""
            )
        else:
            value = item

        value = uppercase_text(value)
        key = normalize_name_for_match(value)

        if not key or key in seen:
            continue

        seen.add(key)
        normalized.append(value)

    return normalized


def validate_expected_roster(
    expected_player_names,
    players_per_team
):
    """Normalize and validate the single roster contract used by every stage."""
    try:
        players_per_team = int(players_per_team)
    except (TypeError, ValueError):
        players_per_team = 0

    expected_players = players_per_team * 2
    names = normalize_expected_names(
        expected_player_names
    )
    keys = [
        normalize_name_for_match(name)
        for name in names
    ]
    valid = (
        players_per_team in {1, 2, 3, 4}
        and len(names) == expected_players
        and all(keys)
        and len(set(keys)) == expected_players
    )
    return {
        "valid": bool(valid),
        "names": names,
        "keys": keys,
        "expectedPlayers": expected_players,
        "playersPerTeam": players_per_team
    }


def fuzzy_name_score(first, second):
    first_normalized = normalize_name_for_match(first)
    second_normalized = normalize_name_for_match(second)

    if not first_normalized or not second_normalized:
        return 0.0

    if first_normalized == second_normalized:
        return 100.0

    sequence_score = SequenceMatcher(
        None,
        first_normalized,
        second_normalized
    ).ratio() * 100.0

    length_score = (
        min(
            len(first_normalized),
            len(second_normalized)
        )
        / max(
            len(first_normalized),
            len(second_normalized)
        )
        * 100.0
    )

    first_chars = set(first_normalized)
    second_chars = set(second_normalized)
    union = first_chars | second_chars

    overlap_score = (
        len(first_chars & second_chars)
        / len(union)
        * 100.0
        if union
        else 0.0
    )

    score = (
        sequence_score * 0.84
        + length_score * 0.10
        + overlap_score * 0.06
    )

    return round(float(score), 2)


def best_assignment_for_group(players, expected_names):
    if not players:
        return [], []

    if not expected_names:
        return [None] * len(players), []

    score_matrix = [
        [
            fuzzy_name_score(
                player.get("username", ""),
                expected_name
            )
            for expected_name in expected_names
        ]
        for player in players
    ]

    row_count = len(players)
    expected_count = len(expected_names)
    best_assignment = [None] * row_count
    best_total = -1.0

    if row_count <= expected_count:
        for assignment in permutations(
            range(expected_count),
            row_count
        ):
            total = sum(
                score_matrix[row_index][expected_index]
                for row_index, expected_index
                in enumerate(assignment)
            )

            if total > best_total:
                best_total = total
                best_assignment = list(assignment)
    else:
        for row_assignment in permutations(
            range(row_count),
            expected_count
        ):
            total = sum(
                score_matrix[row_index][expected_index]
                for expected_index, row_index
                in enumerate(row_assignment)
            )

            if total > best_total:
                best_total = total
                assignment = [None] * row_count

                for expected_index, row_index in enumerate(
                    row_assignment
                ):
                    assignment[row_index] = expected_index

                best_assignment = assignment

    return best_assignment, score_matrix


def team_constrained_name_assignment(
    players,
    expected_names,
    players_per_team
):
    players = list(players or [])
    expected_names = normalize_expected_names(expected_names)
    players_per_team = int(players_per_team or 0)

    assignments = [None] * len(players)
    score_matrix = [
        [0.0 for _ in expected_names]
        for _ in players
    ]

    if (
        not players
        or not expected_names
        or players_per_team <= 0
    ):
        return assignments, score_matrix

    for team_index in (1, 2):
        player_indexes = [
            index
            for index, player in enumerate(players)
            if int(player.get("teamIndex", 0) or 0) == team_index
        ]

        expected_start = (
            0
            if team_index == 1
            else players_per_team
        )
        expected_stop = expected_start + players_per_team
        team_expected_names = expected_names[
            expected_start:expected_stop
        ]
        team_players = [
            players[index]
            for index in player_indexes
        ]

        team_assignment, team_matrix = best_assignment_for_group(
            team_players,
            team_expected_names
        )

        for local_row_index, global_row_index in enumerate(
            player_indexes
        ):
            local_scores = (
                team_matrix[local_row_index]
                if local_row_index < len(team_matrix)
                else []
            )

            for local_expected_index, score in enumerate(
                local_scores
            ):
                global_expected_index = (
                    expected_start + local_expected_index
                )

                if global_expected_index < len(expected_names):
                    score_matrix[
                        global_row_index
                    ][
                        global_expected_index
                    ] = round(float(score), 2)

            assigned_local_index = (
                team_assignment[local_row_index]
                if local_row_index < len(team_assignment)
                else None
            )

            if assigned_local_index is not None:
                assignments[global_row_index] = (
                    expected_start + assigned_local_index
                )

    return assignments, score_matrix
