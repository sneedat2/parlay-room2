# Parlay Room

A shared FanDuel betting slip for your group.

- Sign in with a name and PIN. **Create a group** to become its leader and get a 6-character invite code, or **join a group** with someone's code. You can be in several groups; tap the group name at the top to switch.
- The leader can make a new invite code (the old one stops working) and hand leadership to someone else.
- Search FanDuel props (player props, moneyline, spread, total) with live odds.
- Anyone in the group can add legs.
- Only the person who added a leg, or the group leader, can remove it.
- **Bet in FanDuel** opens that leg in your FanDuel betslip. **Open all in FanDuel** loads the whole parlay at once.
- The slip reloads every 20 seconds, whenever you come back to the tab, and when you tap **Refresh odds**.
- It shows when odds moved since a leg was added, and flags lines FanDuel has pulled.

## 1. Run it on your PC

1. Install Node.js (the LTS version) from https://nodejs.org
2. Copy `.env.example` to `.env`.
3. In this folder, run:

   ```
   npm start
   ```

4. Open http://localhost:3000, sign in, and create your group. You're the leader.
5. Send your friends the invite code from **Invite & members**.

Once the app is online, set `GROUP_CREATE_CODE` in `.env` so only people you give that code to can create groups (and spend your API credits).

With no API key, the app runs on **demo odds** so you can try it out.

## 2. Turn on live FanDuel odds

1. Get a free key at https://the-odds-api.com (500 credits a month).
2. Put it in `.env` as `ODDS_API_KEY=...` and restart the app.

Credit costs:
- Listing sports and games: free
- Opening one market for one game (for example, Pass Yds for Bills @ Dolphins): 1 credit
- Refreshing the slip: 1 credit for each different game and market on it

Results are cached for 2 minutes and shared by everyone. The number of credits left shows at the bottom of the slip.

## 3. Put it online so your friends can use it

Host it on any service that runs Node, such as Render, Railway or Fly.io:

- Start command: `node server.js`
- Set the same variables from `.env` in the host's environment settings.
- The slip is saved in `data.json`. On hosts with temporary disks (like Render's free tier), the file is wiped on every redeploy or restart, and everyone has to join again. To keep it, add a persistent disk and set `DATA_FILE` to a path on that disk.

## Notes

- FanDuel betslip links only open in states where FanDuel is legal, and you need to be signed in to FanDuel.
- Same-game parlays: the odds shown are a simple multiplied estimate. FanDuel prices SGPs itself.
