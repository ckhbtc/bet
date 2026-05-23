# INJ Bet

Perpetual-futures betting UI on [Injective](https://injective.com) — pick an
asset, pick a stake and a target win, hit Place Bet. Live at
**[bet.inj.so](https://bet.inj.so)**.

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

React 18 + Vite + zustand on the client. Express on the server (only for the
fresh-wallet faucet — everything else runs in-browser). `@injectivelabs/sdk-ts`
1.17.8 (pinned — newer breaks EIP-712).

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
| `FAUCET_PRIVATE_KEY` | Optional | Hex EVM private key for an INJ wallet. The server uses it to send 0.001 INJ to fresh wallets so they can pay gas for their first AuthZ grant. If unset, the faucet is a no-op and brand-new wallets won't be able to authorize until they fund themselves manually. |
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
then clears the local grantee key. The Express server only exists to faucet
brand-new wallets; trade endpoints don't exist.

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
│   ├── trade.js             # client-side tradeOpen/tradeClose, MsgAuthzExec broadcast
│   ├── autosign.js          # grantAuthZ/revokeAuthZ — signs MsgGrant/MsgRevoke
│   ├── authzMessages.js     # shared AuthZ grant/revoke message builders
│   ├── injective.js         # read APIs (markets, prices, balances, positions)
│   ├── api.js               # only initAccount (faucet) hits the server
│   ├── bridge.js            # deBridge inbound from Arbitrum USDC → Injective USDC
│   └── wallet.js            # connect/disconnect MetaMask + accountsChanged
├── stores/                  # zustand: walletStore, sessionStore, marketStore
├── styles/global.css        # CSS-vars-based theming (3 themes)
└── server/
    ├── api.js               # /api/init-account router only
    └── faucet.js            # signs the faucet MsgSend with FAUCET_PRIVATE_KEY
```

## Themes

Three themes, switchable via the top-right pill:

- **Bauhaus** (default) — cream paper, primary red/blue/yellow, Archivo Black
- **Dark** — Atrium navy + cyan/blue gradient
- **Light** — Hearth warm cream + terracotta

## Hidden features

Type `D` `E` `V` (sequence within 1.5s, ignored when typing in inputs) to
toggle dev mode. Persists in `localStorage`. Adds a "Cash Out All" button
to the My Bets page.

## License

MIT — see [LICENSE](LICENSE).
