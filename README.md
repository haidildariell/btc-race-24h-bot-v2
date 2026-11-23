# btc-race-24h-bot-v2

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/haidildariell/btc-race-24h-bot-v2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/haidildariell/btc-race-24h-bot-v2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Turn-and-Bank: a cbBTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars with $1,000 of paper money. A full round trip costs roughly 26–45 bps in fees, slippage and price impact, so the bot trades as rarely as possible: it waits for the market to dip and turn — the close rising a little off its trailing 90-bar trough while the recent trend is not in freefall — buys once with everything, and then watches two lines. A hard stop 50 bps under the entry close ends a turn that failed, for a small known loss; a take-profit at +4.65% banks the move instead of giving it back. If the take-profit fires and price later breaks out decisively above the peak it made there, the bot re-enters once and rides that second leg behind a 120 bps trailing stop. At most two entries, ever. Every decision is a pure function of the closes seen so far, computed in exact integer arithmetic: no clock, no network, no randomness, so two runs over the same bars produce byte-identical orders.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout through the vendored kit shim in `vendor/makefun-bars.ts`; the strategy itself is `main.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=haidildariell&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
