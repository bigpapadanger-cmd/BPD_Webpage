export const ROCKET_LEAGUE_CAPABILITY_CATEGORIES = [
    { id: "players", label: "Players" },
    { id: "competitive", label: "Competitive" },
    { id: "community", label: "Community" },
    { id: "account-items", label: "Account / Items" },
    { id: "network-diagnostics", label: "Network / Diagnostics" },
    { id: "advanced", label: "Advanced / Interactive" }
];

export const ROCKET_LEAGUE_CAPABILITIES = [
    { id: "player-profile", label: "Player Profile", category: "players", capability: "player.profile.read", status: "placeholder", access: "read-only", priority: 1, purpose: "Profile information, metadata, progression, and supported account state." },
    { id: "xp-progression", label: "XP / Progression", category: "players", capability: "player.progression.read", status: "placeholder", access: "read-only", priority: null, purpose: "Player XP, level, and progression information." },
    { id: "player-stats", label: "Player Stats", category: "players", capability: "player.stats.read", status: "placeholder", access: "read-only", priority: 2, purpose: "Career statistics and future website profile enrichment." },
    { id: "match-history", label: "Match History", category: "players", capability: "matches.history.read", status: "placeholder", access: "read-only", priority: 3, purpose: "Recent matches and metadata for possible OCR match-record correlation." },
    { id: "mmr-skills", label: "MMR / Skills", category: "competitive", capability: "mmr.skills.read", status: "active", access: "read-only", priority: null, purpose: "Current production MMR / Skills integration.", serviceId: "mmr-api" },
    { id: "leaderboards", label: "Leaderboards", category: "competitive", capability: "leaderboards.read", status: "placeholder", access: "read-only", priority: 6, purpose: "Supported skill/MMR or statistics leaderboards." },
    { id: "playlists", label: "Playlists", category: "competitive", capability: "playlists.read", status: "placeholder", access: "read-only", priority: 4, purpose: "Playlist metadata, names, availability, and MMR mode labels." },
    { id: "population", label: "Population", category: "competitive", capability: "population.read", status: "placeholder", access: "read-only", priority: 5, purpose: "Supported Rocket League and playlist population information." },
    { id: "clubs", label: "Clubs", category: "community", capability: "clubs.read", status: "placeholder", access: "read-only", priority: 7, purpose: "Club details, membership, and supported metadata." },
    { id: "tournaments", label: "Tournaments", category: "community", capability: "tournaments.read", status: "placeholder", access: "read-only", priority: 8, purpose: "Tournament schedules, discovery, and information." },
    { id: "training", label: "Training", category: "community", capability: "training.read", status: "placeholder", access: "read-only", priority: 9, purpose: "Training metadata and training-pack discovery." },
    { id: "rocket-pass", label: "Rocket Pass", category: "account-items", capability: "rocket-pass.read", status: "placeholder", access: "read-only", priority: 10, purpose: "Supported Rocket Pass information and player progression state." },
    { id: "inventory-products", label: "Inventory / Products", category: "account-items", capability: "inventory.read", status: "placeholder", access: "read-only", priority: 11, purpose: "Supported item, product, and ownership information; no mutations." },
    { id: "item-shop", label: "Item Shop", category: "account-items", capability: "item-shop.read", status: "placeholder", access: "read-only", priority: 12, purpose: "Supported shop catalogue, item metadata, and rotations." },
    { id: "wallet", label: "Wallet", category: "account-items", capability: "wallet.read", status: "placeholder", access: "read-only", priority: 13, purpose: "Supported wallet or currency information; no spending." },
    { id: "challenges", label: "Challenges", category: "account-items", capability: "challenges.read", status: "placeholder", access: "read-only", priority: 14, purpose: "Challenge lists, progress, and completion state; no reward claims." },
    { id: "regions", label: "Regions", category: "network-diagnostics", capability: "regions.read", status: "placeholder", access: "read-only", priority: 15, purpose: "Rocket League region and subregion information." },
    { id: "ping-game-servers", label: "Ping / Game Servers", category: "network-diagnostics", capability: "game-servers.diagnostics.read", status: "placeholder", access: "read-only", priority: 16, purpose: "Supported game-server, region, ping, and operational diagnostics." },
    { id: "party", label: "Party", category: "advanced", capability: "party.interactive", status: "future", access: "interactive", priority: 17, purpose: "Potential future party state or management; not implemented." },
    { id: "matchmaking", label: "Matchmaking", category: "advanced", capability: "matchmaking.interactive", status: "future", access: "interactive", priority: 18, purpose: "Potential future matchmaking state or queue operations; not implemented." },
    { id: "reservations-join-match", label: "Reservations / Join Match", category: "advanced", capability: "match-reservations.interactive", status: "future", access: "interactive", priority: 19, purpose: "Potential future reservation or join-match capability; not implemented." }
];
