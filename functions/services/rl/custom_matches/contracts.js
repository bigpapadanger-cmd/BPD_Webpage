"use strict";

export class CustomMatchError extends Error {
    constructor(code = "CUSTOM_MATCH_UNAVAILABLE", status = 503) {
        super(code);
        this.name = "CustomMatchError";
        this.code = code;
        this.status = status;
    }
}

const invalid = () => { throw new CustomMatchError("CUSTOM_MATCH_INPUT_INVALID", 400); };
const malformed = () => { throw new CustomMatchError("CUSTOM_MATCH_RESPONSE_INVALID", 502); };
const enumOf = values => value => values.includes(value) ? value : invalid();
const text = max => value => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : invalid();
const boundedText = max => value => typeof value === "string" && value.length <= max ? value : invalid();
const integer = min => value => Number.isSafeInteger(value) && value >= min ? value : invalid();
const boolean = value => typeof value === "boolean" ? value : invalid();
const nullable = validator => value => value === null ? null : validator(value);
const optional = validator => ({ validator });
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : invalid();
export const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : invalid();
export const code = prefix => value => typeof value === "string" && new RegExp(`^${prefix}[A-Za-z0-9]{${({ CM: 8, CMM: 8, CMI: 12, CMJ: 10, CMR: 8, CMP: 8, CMRD: 8, CMV: 8 })[prefix]}}$`).test(value) ? value : invalid();
const visibility = enumOf(["public", "private"]);
const joinPolicy = enumOf(["open", "invite_only", "approval"]);
const team = enumOf(["a", "b", "spectator"]);
const playingTeam = enumOf(["a", "b"]);
const state = enumOf(["created", "open", "lobby", "pregame", "active", "results", "archived", "cancelled"]);
const winningTeam = nullable(enumOf(["a", "b", "draw"]));
const resultSource = nullable(enumOf(["provider", "user_confirmed", "admin_reviewed"]));
const verificationStatus = nullable(enumOf(["pending", "matched", "verified", "conflict", "unavailable"]));

function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    return value;
}

// Requests reject unknown keys; responses explicitly project documented fields.
function shape(value, fields, strict = true) {
    object(value);
    if (strict && Object.keys(value).some(key => !Object.hasOwn(fields, key))) invalid();
    const output = {};
    for (const [key, rule] of Object.entries(fields)) {
        if (!Object.hasOwn(value, key)) {
            if (typeof rule === "object") continue;
            invalid();
        }
        output[key] = (typeof rule === "object" ? rule.validator : rule)(value[key]);
    }
    return output;
}
const array = validator => value => Array.isArray(value) && value.length <= 1000 ? value.map(validator) : invalid();
const projection = fields => value => shape(value, fields, false);
const empty = {};
const actionFields = Object.freeze({
    open: empty, join: { team: playingTeam }, leave: empty,
    kick_member: { memberCode: code("CMM"), reason: optional(text(500)) },
    transfer_host: { memberCode: code("CMM") }, assign_team: { memberCode: code("CMM"), team },
    resize: { teamACapacity: integer(1), teamBCapacity: integer(1) },
    set_join_policy: { joinPolicy }, set_allow_join_after_start: { allowJoinAfterStart: boolean },
    begin_pregame: empty, start: empty, cancel: empty, close: empty, archive: empty,
    // targetAccountId deliberately has no browser schema. Targeted invites need a server resolver.
    create_invite: { maxUses: optional(value => value <= 100 ? integer(1)(value) : invalid()), expiresAt: optional(timestamp), team: optional(team) },
    revoke_invite: { inviteCode: code("CMI") }, join_with_invite: { inviteCode: code("CMI"), team: optional(playingTeam) },
    request_join: { team: optional(playingTeam) }, cancel_join_request: { requestCode: code("CMJ") },
    approve_join: { requestCode: code("CMJ"), team: optional(playingTeam), reason: optional(text(500)) },
    reject_join: { requestCode: code("CMJ"), reason: optional(text(500)) }, allow_rejoin: { memberCode: code("CMM") }
});
const createFields = {
    gameKey: optional(enumOf(["rocketleague"])), modeKey: optional(text(120)), title: text(120), visibility: optional(visibility),
    joinPolicy: optional(joinPolicy), teamACapacity: optional(integer(1)), teamBCapacity: optional(integer(1)),
    allowJoinAfterStart: optional(boolean), region: optional(nullable(boundedText(50))), mapName: optional(nullable(boundedText(120)))
};
const versioned = { matchCode: code("CM"), expectedVersion: integer(1), idempotencyKey: uuid };
const roundVersioned = { ...versioned, roundCode: code("CMRD"), expectedRoundVersion: integer(1) };
export const OPERATIONS = Object.freeze({
    limits: "get_custom_match_limits", list: "list_custom_matches", detail: "get_custom_match", credentials: "get_custom_match_credentials",
    invites: "list_custom_match_invites", joinRequests: "list_custom_match_join_requests", memberHistory: "list_custom_match_member_history",
    rounds: "list_custom_match_rounds", voteResult: "get_custom_match_vote_result", playerResults: "get_custom_match_player_results",
    create: "create_custom_match", action: "apply_custom_match_action", beginRound: "begin_custom_match_round",
    openVote: "open_custom_match_vote", castVote: "cast_custom_match_vote", resolveVote: "resolve_custom_match_vote",
    submitResult: "submit_custom_match_result", confirmResult: "confirm_custom_match_result"
});

export function validateCustomMatchRequest(operation, input, now = Date.now()) {
    if (!Object.hasOwn(OPERATIONS, operation)) invalid();
    let fields;
    switch (operation) {
        case "limits": fields = { gameKey: optional(enumOf(["rocketleague"])) }; break;
        case "list": fields = { gameKey: optional(enumOf(["rocketleague"])), state: optional(nullable(state)), page: optional(integer(1)), pageSize: optional(value => value <= 100 ? integer(1)(value) : invalid()) }; break;
        case "detail": case "credentials": case "rounds": case "playerResults": case "invites": case "joinRequests": case "memberHistory": fields = { matchCode: code("CM") }; break;
        case "voteResult": fields = { matchCode: code("CM"), roundCode: code("CMRD") }; break;
        case "create": fields = { idempotencyKey: uuid, options: value => shape(value, createFields) }; break;
        case "action": fields = { ...versioned, action: enumOf(Object.keys(actionFields)), payload: value => object(value) }; break;
        case "beginRound": fields = versioned; break;
        case "openVote": case "resolveVote": fields = roundVersioned; break;
        case "castVote": fields = { matchCode: code("CM"), roundCode: code("CMRD"), idempotencyKey: uuid, vote: object }; break;
        case "submitResult": fields = { ...versioned, teamAScore: integer(0), teamBScore: integer(0) }; break;
        case "confirmResult": fields = { ...versioned, resultCode: code("CMR") }; break;
    }
    const result = shape(input, fields);
    if (operation === "action") {
        result.payload = shape(result.payload, actionFields[result.action]);
        if (result.payload.expiresAt && Date.parse(result.payload.expiresAt) <= now) invalid();
    }
    if (operation === "castVote") {
        const votes = { player_target: { voteType: enumOf(["player_target"]), targetMemberCode: code("CMM") }, skip: { voteType: enumOf(["skip"]) },
            yes_no: { voteType: enumOf(["yes_no"]), choiceKey: enumOf(["yes", "no"]) }, option: { voteType: enumOf(["option"]), choiceKey: value => text(200)(value).toLowerCase() } };
        if (!Object.hasOwn(votes, result.vote.voteType)) invalid();
        result.vote = shape(result.vote, votes[result.vote.voteType]);
    }
    return result;
}

export function toCustomMatchRpcParameters(operation, input, accountId) {
    const actor = uuid(accountId);
    const p = {};
    if (["limits", "list"].includes(operation)) p.p_game_key = input.gameKey ?? "rocketleague";
    else p.p_actor_account_id = actor;
    if (input.matchCode) p.p_match_code = input.matchCode;
    if (input.roundCode) p.p_round_code = input.roundCode;
    if (input.idempotencyKey) p.p_idempotency_key = input.idempotencyKey;
    if (operation === "list") Object.assign(p, { p_state: input.state ?? null, p_page: input.page ?? 1, p_page_size: input.pageSize ?? 30 });
    if (operation === "create") p.p_options = input.options;
    if (operation === "action") Object.assign(p, { p_expected_version: input.expectedVersion, p_action: input.action, p_payload: input.payload });
    if (["beginRound", "openVote", "resolveVote", "submitResult", "confirmResult"].includes(operation)) p.p_expected_match_version = input.expectedVersion;
    if (["openVote", "resolveVote"].includes(operation)) p.p_expected_round_version = input.expectedRoundVersion;
    if (operation === "castVote") p.p_vote = input.vote;
    if (operation === "submitResult") Object.assign(p, { p_team_a_score: input.teamAScore, p_team_b_score: input.teamBScore });
    if (operation === "confirmResult") p.p_result_code = input.resultCode;
    return p;
}

const identityFields = { matchCode: code("CM"), title: text(120), gameKey: enumOf(["rocketleague"]), modeKey: text(120), modeVersion: integer(1), visibility, joinPolicy,
    teamACapacity: integer(1), teamBCapacity: integer(1), allowJoinAfterStart: boolean, state, region: nullable(boundedText(50)), mapName: nullable(boundedText(120)) };
const countFields = { teamACount: integer(0), teamBCount: integer(0), spectatorCount: integer(0), playerCount: integer(0) };
const activityFields = { openedAt: nullable(timestamp), startedAt: nullable(timestamp), lastActivityAt: nullable(timestamp) };
const scores = { teamAScore: nullable(integer(0)), teamBScore: nullable(integer(0)), winningTeam, resultSource, verificationStatus };
const roundCounts = { roundBased: boolean, currentRoundNumber: nullable(integer(0)), roundCount: integer(0) };
const credentials = projection({ lobbyName: value => /^[a-z0-9]{10}$/.test(value) && typeof value === "string" ? value : invalid(), lobbyPassword: value => /^[a-z0-9]{10}$/.test(value) && typeof value === "string" ? value : invalid() });
// modeResult has no supplied nested public-safe schema. Only null is currently supported.
const modeResult = value => value === null ? null : malformed();
const voteResult = { resultType: text(120), winningMemberCode: nullable(code("CMM")), totalEligibleVoters: integer(0), totalVotesCast: integer(0), abstainCount: integer(0),
    thresholdType: text(120), thresholdRequired: integer(0), winningVoteCount: integer(0), majorityAchieved: boolean, modeResult };
const success = value => value === true ? true : invalid();
const envelope = fields => projection({ success, ...fields });

export function sanitizeCustomMatchResponse(operation, raw) {
    try {
        let fields;
        switch (operation) {
            case "limits": fields = { gameKey: enumOf(["rocketleague"]), maxTeamCapacity: integer(1), defaultTeamCapacity: integer(1), maxTotalParticipants: integer(2), defaultAllowJoinAfterStart: boolean,
                modes: array(projection({ modeKey: text(120), displayName: text(120), modeVersion: integer(1), usesTeams: boolean, usesRounds: boolean, usesVoting: boolean,
                    defaultTeamACapacity: integer(1), defaultTeamBCapacity: integer(1), maxRounds: nullable(integer(1)) })) }; break;
            case "list": fields = { page: integer(1), pageSize: integer(1), total: integer(0), hasMore: boolean,
                matches: array(projection({ ...identityFields, ...countFields, ...activityFields, ...roundCounts, gameMode: nullable(text(120)), totalCapacity: integer(2), acceptingMembers: boolean, hostDisplayName: text(120) })) }; break;
            case "detail": fields = { match: projection({ ...identityFields, ...countFields, ...activityFields, ...roundCounts, ...scores, version: integer(1), gameMode: nullable(text(120)), hostDisplayName: text(120), createdAt: timestamp, closedAt: nullable(timestamp) }),
                actor: nullable(projection({ isHost: boolean, isMember: boolean, memberCode: nullable(code("CMM")), team: nullable(team), memberRole: nullable(enumOf(["host", "player", "spectator"])), eligible: boolean, canJoin: boolean })),
                members: array(projection({ memberCode: code("CMM"), displayName: text(120), team, memberRole: enumOf(["host", "player", "spectator"]), joinedAt: timestamp, joinedMatchState: state, joinedRoundNumber: nullable(integer(0)) })), capturedAt: timestamp }; break;
            case "create": fields = { match: projection({ ...identityFields, version: integer(1), roundBased: boolean, usesVoting: boolean, hostMemberCode: code("CMM") }), credentials, capturedAt: timestamp }; break;
            case "credentials": fields = { matchCode: code("CM"), credentials, capturedAt: timestamp }; break;
            case "invites": fields = { matchCode: code("CM"), invites: array(projection({ inviteCode: code("CMI"), targetDisplayName: nullable(boundedText(120)),
                intendedTeam: nullable(team), maxUses: nullable(integer(1)), useCount: integer(0), remainingUses: nullable(integer(0)),
                expiresAt: nullable(timestamp), createdAt: timestamp })), capturedAt: timestamp }; break;
            case "joinRequests": fields = { matchCode: code("CM"), requests: array(projection({ requestCode: code("CMJ"), displayName: nullable(boundedText(120)),
                requestedTeam: nullable(playingTeam), status: enumOf(["pending"]), requestedAt: timestamp })), capturedAt: timestamp }; break;
            case "memberHistory": fields = { matchCode: code("CM"), members: array(projection({ memberCode: code("CMM"), displayName: nullable(boundedText(120)),
                team: nullable(team), memberRole: enumOf(["host", "player", "spectator"]), joinedAt: timestamp, leftAt: timestamp, joinedMatchState: state,
                joinedRoundNumber: nullable(integer(0)), departureReason: nullable(enumOf(["left", "kicked", "match_closed", "disconnected", "removed_by_admin"])),
                kickedByDisplayName: nullable(boundedText(120)), canAllowRejoin: boolean })), capturedAt: timestamp }; break;
            case "action": fields = { matchCode: code("CM"), action: enumOf(Object.keys(actionFields)), previousVersion: integer(1), version: integer(1), memberCode: nullable(code("CMM")), inviteCode: nullable(code("CMI")), requestCode: nullable(code("CMJ")), capturedAt: timestamp }; break;
            case "rounds": fields = { matchCode: code("CM"), rounds: array(projection({ roundCode: code("CMRD"), roundNumber: integer(1), roundVersion: optional(integer(1)), state: text(40), startedAt: nullable(timestamp), votingOpenedAt: nullable(timestamp), votingClosedAt: nullable(timestamp), endedAt: nullable(timestamp), outcomeType: nullable(text(120)), outcomeKey: nullable(text(200)) })) }; break;
            case "beginRound": case "openVote": fields = { matchCode: code("CM"), roundCode: code("CMRD"), roundNumber: integer(1), roundState: enumOf([operation === "beginRound" ? "active" : "voting"]), matchVersion: integer(1), roundVersion: integer(1), [operation === "beginRound" ? "startedAt" : "votingOpenedAt"]: timestamp }; break;
            case "castVote": fields = { matchCode: code("CM"), roundCode: code("CMRD"), hasVoted: success, voteCode: code("CMV"), capturedAt: timestamp }; break;
            case "voteResult": fields = raw?.resolved === false ? { resolved: value => value === false ? false : invalid(), roundCode: code("CMRD"), roundState: text(40) }
                : { resolved: success, roundCode: code("CMRD"), roundNumber: integer(1), result: projection({ ...voteResult, winningChoiceKey: nullable(text(200)), winningTeam, resolvedAt: timestamp }) }; break;
            case "resolveVote": fields = { matchCode: code("CM"), roundCode: code("CMRD"), result: projection({ ...voteResult, tie: boolean }), matchVersion: integer(1), roundVersion: integer(1), resolvedAt: timestamp }; break;
            case "submitResult": fields = { matchCode: code("CM"), resultCode: code("CMR"), status: enumOf(["submitted"]), submittedForTeam: playingTeam, teamAScore: integer(0), teamBScore: integer(0), winningTeam, verificationStatus, version: integer(1), capturedAt: timestamp }; break;
            case "confirmResult": fields = { matchCode: code("CM"), resultCode: code("CMR"), confirmationComplete: boolean, confirmedByTeamA: boolean, confirmedByTeamB: boolean, status: enumOf(["submitted", "confirmed", "rejected", "conflict"]), ...scores, version: integer(1), capturedAt: timestamp }; break;
            case "playerResults": {
                const stats = Object.fromEntries(["teamScore", "opponentScore", "placement", "roundsPlayed", "roundsWon", "roundsLost", "survivedRounds", "eliminations", "votesCast", "votesReceived", "correctVotes", "incorrectVotes", "timesVotedOut", "score", "goals", "assists", "saves", "shots", "demolishes", "ownGoals", "secondsPlayed"].map(key => [key, nullable(integer(0))]));
                fields = { matchCode: code("CM"), state, ...scores, players: array(projection({ playerResultCode: code("CMP"), memberCode: code("CMM"), displayName: text(120), team: playingTeam,
                    outcome: enumOf(["win", "loss", "draw", "survived", "eliminated"]), ...stats, providerVerified: nullable(boolean), mvp: nullable(boolean), createdAt: timestamp })), capturedAt: timestamp }; break;
            }
            default: malformed();
        }
        const result = envelope(fields)(raw);
        if (operation === "action") {
            const memberAction = ["join", "join_with_invite", "approve_join"].includes(result.action);
            if ((memberAction ? result.memberCode === null : result.memberCode !== null)
                || (result.action === "create_invite" ? result.inviteCode === null : result.inviteCode !== null)
                || (result.action === "request_join" ? result.requestCode === null : result.requestCode !== null)) malformed();
        }
        return result;
    } catch { malformed(); }
}

const errors = {
    CUSTOM_MATCH_NOT_FOUND: 404, CUSTOM_MATCH_VERSION_CONFLICT: 409, CUSTOM_MATCH_ROUND_VERSION_CONFLICT: 409,
    CUSTOM_MATCH_HOST_REQUIRED: 403, CUSTOM_MATCH_TEAM_FULL: 409, CUSTOM_MATCH_ALREADY_JOINED: 409,
    CUSTOM_MATCH_JOIN_FORBIDDEN: 403, CUSTOM_MATCH_JOIN_AUTHORIZATION_REQUIRED: 403, CUSTOM_MATCH_REJOIN_AFTER_KICK_FORBIDDEN: 403,
    CUSTOM_MATCH_HOST_TRANSFER_REQUIRED: 409, CUSTOM_MATCH_JOIN_AFTER_START_DISABLED: 409,
    CUSTOM_MATCH_CREDENTIALS_FORBIDDEN: 403, CUSTOM_MATCH_CREDENTIALS_UNAVAILABLE: 409,
    CUSTOM_MATCH_RESULT_ALREADY_EXISTS: 409, CUSTOM_MATCH_RESULT_SELF_CONFIRMATION_FORBIDDEN: 403, ACCOUNT_ACCESS_RESTRICTED: 403
};
export function customMatchDomainError(raw) {
    const value = raw?.code && Object.hasOwn(errors, raw.code) ? raw.code : raw?.message;
    if (!Object.hasOwn(errors, value)) return new CustomMatchError();
    return new CustomMatchError(value, errors[value]);
}
