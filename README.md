# YOLO

Perpetual-futures betting UI on [Injective](https://injective.com) — pick an
asset, pick a stake and a target win, hit Place Bet. Live at
**[yolo.inj.so](https://yolo.inj.so)**.

Under the hood it's just perp trades, but framed as bets: enter your stake +
desired win, the app computes the implied target price and opens a market
order with a reduce-only limit at the target (TP). One-click "Cash Out" closes
the position.

## Why it's different

- **One signature, ever.** Sign a single AuthZ grant and you're done — no
  wallet popup per trade.
- **Gas-free trades.** Broadcasts go through Injective's fee-delegation
  relay; the user pays nothing in gas after the initial grant.
- **Client-side custody.** The grantee key never leaves the browser. Trades
  are signed and broadcast in-browser via `MsgAuthzExec`. No server holds
  user secrets.
- **Revocable grants.** AuthZ expires year 2099 by default, and the app exposes
  an on-chain Revoke autosign action that signs `MsgRevoke` for every delegated
  trading message type. Clearing localStorage or disconnecting only removes the
  local session key; it does not revoke the on-chain grant.

## Tech

React 18 + Vite + zustand on the client. Express handles the fresh-wallet
faucet, permissionless CCTP mint relay, and broadcast of already-signed RFQ
transactions. Trade keys and signing stay in-browser.

## Run locally

```bash
npm install
cp .env.example .env       # then fill in FAUCET_PRIVATE_KEY (optional, see below)
npm run dev                # vite dev server on :36000
npm run dev:api            # in a second terminal — faucet API on :36001
```

The Vite config proxies `/api/*` to `localhost:36001`, so the front and back
can run independently.

To build + serve a production-shaped artifact:

```bash
npm run build              # → dist/
npm start                  # → http://localhost:36000 (or PORT env)
```

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `FAUCET_PRIVATE_KEY` | Optional | Hex EVM private key for an INJ wallet. The server uses it to fund fresh wallets and pay gas for permissionless CCTP mint submissions. If unset, both operations are unavailable. |
| `PORT` | Optional | Production listen port for `server.js`. Defaults to `36000`. |
| `API_PORT` | Optional | Dev-only API port for `dev-server.js`. Defaults to `36001`. |

## Architecture (one paragraph)

The user signs **one** `MsgGrant` from MetaMask delegating derivative-trading
permission to an ephemeral key generated in the browser. That key is stored
in `localStorage` (keyed by granter `inj1` so multi-wallet users don't cross
streams). For every subsequent bet, the browser wraps the trade message in
`MsgAuthzExec`, signs it with the local grantee key, and broadcasts via
`MsgBroadcasterWithPk.broadcastWithFeeDelegation` — no popup, no gas, no
server roundtrip. When the user chooses Revoke autosign, the browser signs
`MsgRevoke` from the granter wallet for each delegated trading message type and
then clears the local grantee key. The Express server faucets brand-new wallets,
submits permissionless CCTP mints, and broadcasts already-signed RFQ transactions.
It never receives a user's trade key.

For the long version see [`~/.claude/skills/injective-autosign/SKILL.md`](https://github.com/ckhbtc/bet#readme)
in the dev's local skills (architecture choices: client custody vs server
custody) — too long to inline here.

## Repo layout

```
src/
├── App.jsx                  # top-level state, theme cycling, dev-mode keystroke
├── components/              # all UI (BetPanel, ActiveBets, AuthZSetup, TopBar...)
├── data/mockData.js         # AGGRESSIVENESS, formatPrice/formatDollar, liq math
├── services/
│   ├── grantee.js           # localStorage helpers — keyed by granter inj1
│   ├── trade.js             # shared AuthZ broadcast and orderbook cleanup helpers
│   ├── autosign.js          # grantAuthZ/revokeAuthZ — signs MsgGrant/MsgRevoke
│   ├── authzMessages.js     # shared AuthZ grant/revoke message builders
│   ├── injective.js         # read APIs (markets, prices, balances, positions)
│   ├── api.js               # client wrappers for faucet and CCTP relay
│   ├── cctp.js              # CCTP V2 chain configs + ABIs (ported from usdc-widget)
│   ├── bridge.js            # CCTP V2 burn-and-mint: 6 EVM chains → native USDC on Injective
│   └── wallet.js            # connect/disconnect MetaMask + accountsChanged
├── stores/                  # zustand: walletStore, sessionStore, marketStore
├── styles/global.css        # CSS-vars-based Bauhaus theming (2 variants)
└── server/
    ├── api.js               # faucet, CCTP relay, and signed RFQ relay routes
    ├── faucet.js            # funds fresh accounts with FAUCET_PRIVATE_KEY
    ├── relayMint.js          # submits permissionless CCTP mints
    └── rfqBroadcast.js       # broadcasts already-signed RFQ transactions
```

## Themes

Two Bauhaus variants, switchable via the top-right pill:

- **Bauhaus** (default) — cream paper, ink text, red and yellow accents
- **Bauhaus dark** — warm ink paper, cream text, red and yellow accents

## Hidden features

Type `D` `E` `V` (sequence within 1.5s, ignored when typing in inputs) to
toggle dev mode. Persists in `localStorage`. Adds a "Cash Out All" button
to the My Bets page.

## License

MIT — see [LICENSE](LICENSE).
