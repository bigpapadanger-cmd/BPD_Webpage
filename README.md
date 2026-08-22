PROJECT SETUP & DEVELOPMENT GUIDE

    Required VS Code Extensions:
        - Live Share (Microsoft)
        - GitHub Repositories (GitHub)
        - GitHub Pull Requests (GitHub)
        - GitHub Actions (GitHub)

    Git Installation Settings:
        Git:
            - Line Endings: Checkout Windows‑style, commit Unix‑style
            - Pull Behavior: Rebase
            - Credential Manager: Git Credential Manager Core
            - Default Branch: master
        Terminal:
            - Terminal Emulator: Windows Terminal
            - Shell: PowerShell
        SSL/TLS:
            - TLS Library: Windows Secure Channel (Schannel)
        VS Code:
            - Default Editor: VS Code
            - VS Code Terminal: Windows Terminal (PowerShell)

    Cloudflare Pages Deployment:
        - Production Branch: master
        - Preview Builds: Enabled for all non‑default branches
        - Access Protection: Configure as needed

    Git Auto‑Fetch (IMPORTANT):
        - Open VS Code
        - Press Ctrl + ,
        - Search: git autofetch
        - Enable Auto‑Fetch
        - (Optional) Run: git pull

    Git Workflow Commands:
        Updating .gitignore:
            - git add .gitignore
            - git commit -m "Update .gitignore"
            - git push
        Committing All Changes:
            - git add .
            - git commit -m "{ADD CHANGE DETAILS - INITIALS}"
            - git push

    Repository Structure (Key Locations):
        domainData/
            functions/                  ← Cloudflare Pages Functions (server-side API)
                auth/                   ← Epic login, callback, session handlers
                rocketleague/           ← Rocket League profile API
                routes/                 ← Routing table
                index.js                ← Worker entrypoint
            kv/                         ← KV helper modules (not KV data)
                auth_sessions.js
                rl_profiles.js
                kv_namespaces.json      ← Optional reference file
            public/                     ← Static assets (CSS, JS, images)
            .env.example                ← Environment variable names only
            wrangler.toml               ← KV bindings + Worker configuration
