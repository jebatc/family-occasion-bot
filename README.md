# Holiday Coordinator

A WhatsApp assistant for hosting family gatherings. It sends the invitations, keeps track of who's coming by household, asks people to bring dishes, answers their questions from your plan, sends daily nudges to anyone who hasn't answered, and checks with you on anything it isn't sure about. You run it by texting it, and your family just texts it like a person.

It was built for a family Thanksgiving, but nothing in it is Thanksgiving-specific. A birthday dinner, a reunion, a holiday brunch or a potluck works the same way: you describe the occasion in a few plain files, and the assistant takes on a persona you choose ("Tom the Turkey 🦃" for Thanksgiving, someone else for the next occasion).

> **Read this first.** The assistant uses [Baileys](https://github.com/WhiskeySockets/Baileys) to run on a WhatsApp number linked as a device, the same way WhatsApp Web links. It's not an official WhatsApp API. Meta's official API is for businesses and turned down our family use, so this is the practical route, but automating a number this way is against WhatsApp's terms and the number can be banned. **Use a spare number, never your personal one,** and keep it to family-sized volume. The bot spaces out bulk messages to help.

## What it's like

For your family, it's a contact that texts them:

> **Tom 🦃:** Hi Robin & Pat! You're invited to Thanksgiving 2026 at Alex & Sam's on Thursday, November 26, 123 Example St. Arrive between 10:00 and 11:00 AM. Will you be joining? Reply YES or NO. — Tom 🦃
>
> **Robin:** YES!
>
> **Tom 🦃:** Gobble gobble, that's great news! You and Pat are on the list. See you Thursday, arrive between 10 and 11. — Tom 🦃
>
> **Tom 🦃** (to Pat, a few seconds later): Hi Pat! Robin let me know you're both coming to Thanksgiving. See you there! … For Thanksgiving, could you please bring: • Spanakopita • Cranberry Sauce. Reply YES if you can do them all, tell me which ones work, or send me any questions.
>
> **Pat:** Yes to both. Can I bring my friend Dana too?
>
> **Tom 🦃:** Great, both are on the menu! Let me check with Alex about Dana and get back to you.

And for you, the host:

> **Tom 🦃:** #4 Pat Lee asks: Can Dana come too? Suggested reply: "Of course, the more the merrier!" Reply "#4 ok" to send it, or "#4 <your answer>".
>
> **You:** #4 ok
>
> **You:** status
>
> **Tom 🦃:** Thanksgiving 2026: 6 coming. Robin & Pat: yes (2) · Spanakopita ✅ · Cranberry Sauce ✅ …

## How an occasion flows

1. **Announce.** You text the bot `announce …`, and it posts an introduction to your family's WhatsApp group.
2. **Invite.** You text `rsvp`. Each household gets one invitation, addressed to everyone in it, or custom text for a household (for example, the people staying over the night before).
3. **Confirm.** When anyone replies YES, the bot confirms, lets the rest of their household know, and counts the whole household. Kids without phones are counted but never texted.
4. **Request.** Right after a yes, that household gets its dish requests: one message per person, listing what you've asked them to bring.
5. **Follow up.** Once a day, during daytime, anyone who hasn't RSVP'd or confirmed their dishes gets a short nudge. It stops after the event.
6. **Settle the details.** People confirm or decline dishes, ask for your recipe, offer new dishes for you to approve, and tell the bot oven temperatures. The plan updates itself as they do.

Anything the bot isn't sure about comes to you as a numbered question. Nothing about extra guests, new dishes or changes to the plan happens without your OK.

## Your plan lives in plain files

You describe the occasion in a private folder of plain text files, which you can edit at any time. The bot re-reads them on every message.

```
private/                              ← never committed to this repo; keep it in a private repo of its own
  .env                                API key, the bot's number, the family group's name
  family.yaml                         people, phones, households, dietary needs
  recipes/                            recipe files the bot can send
  holidays/<occasion>/
    persona.yaml                      who the bot is: name, tone, sign-off
    requests.yaml                     how each dish is worded when asking for it (carries over year to year)
    <year>/event.yaml                 date, address, invitations, ovens, and the menu
    <year>/plan.md                    your master plan and prep calendar (the bot answers from it)
    <year>/schedule.md                the day's timeline
    <year>/state.db                   RSVPs, messages, questions, audit log (written by the bot)
```

Pick the occasion with `HOLIDAY` and `YEAR` in `.env` (for example `HOLIDAY=thanksgiving`, `YEAR=2026`). A new occasion is a new folder.

**`family.yaml`** lists the host and everyone else, each with a phone number, a `household` (people who RSVP and are counted together) and optional `dietary` needs (e.g. `gluten-free`). Leave out the phone for children.

**`event.yaml`** holds:
- `planning`: what guests need up front (`arrival`, `address`, …). The invitation uses the date, the address and `arrival`.
- `invitations`: optional custom invitation text per household.
- `day_of: ovens`: the ovens you have, and which one is gluten-free only.
- `menu`: every dish and day-of task. Each entry has:

| Field | What it's for |
|---|---|
| `dish`, `description` | A short name, plus the specifics |
| `owner`, `status` | Who's making it (a name, or a list of names for a shared task), and where it stands: `Proposed` (not asked yet), `Requested` (asked), `Confirmed`. The bot updates the status as people reply |
| `plan` | What's needed up front: `serves`, `dietary`, `recipe` (a file in `recipes/`), `notes` |
| `shopping`, `prep_ahead`, `day_of` | What to buy, what to do before the day, and the day itself (starting with when it's served) |
| `oven` | Which oven, when, and the temperature. The bot asks guests for their temperatures |
| `fallback` | Who takes the dish if the owner says no |
| `confirm_on_rsvp` | For tasks that come with attending: never asked about, confirmed by the household's yes |
| `course: Task` | A day-of job ("Glaze the carrots at 1:33") rather than something to bring |

`examples/data/` has a small, complete example to copy from.

## Texting the bot

From the host's own phone:

| Text | What happens |
|---|---|
| `status` | Who's coming, who's bringing what, open questions |
| `announce <message>` | Posts to the family group in the persona's voice |
| `rsvp` | Invites every household that hasn't answered |
| `request` / `request <name>` | Sends dish requests to households that said yes (normally automatic), or just one person's household |
| `remind` | Sends any reminders that are due right now (normally once a day, automatically) |
| `#<n> ok` / `#<n> no` / `#<n> <answer>` | Answers a question the bot sent you, approves or turns down an offered dish |
| `tell <name>: <message>` | Sends your own words to someone through the bot |
| `ovens` | Each oven's lineup in time order, with temperatures |
| `temps` / `temp <dish> <°F> [minutes]` | Asks guests for missing oven temperatures, or sets one for your own dish |
| `changes` | The latest changes guests' messages made, and any messages it held back |

## Guardrails

Family members can't make the bot run code or change things they shouldn't:

- **Narrow actions only.** The AI can only reply, record an RSVP, confirm or decline its sender's own dishes, send a recipe you provided, propose a dish for you to approve, save dietary or oven details for its sender's own dishes, or ask you. Each is limited to the sender's own household.
- **Screening.** Every message is first checked by a small, fast model. Off-topic requests get a polite "I can only help with Thanksgiving plans". Anything suspicious (trying to change the bot's rules, asking for other people's details, acting for another household) gets no reply and comes to you.
- **Limits.** Each message can make only a few changes, each guest can have only a couple of pending dish ideas, text is trimmed, and auto-replies pause if one person sends too many messages.
- **No phone numbers out.** A reply containing a phone number is blocked and shown to you instead.
- **You stay informed.** You're told when someone changes a yes, declines a dish, or offers something that doesn't fit a family member's dietary needs. Every change is logged.

## Getting started

You'll need:
- Node 24 or newer
- an [Anthropic API key](https://console.anthropic.com)
- a spare phone number with WhatsApp (the WhatsApp Business app works well, and can run next to your personal WhatsApp on the same phone)
- a computer that stays on during the planning weeks (a Mac is easiest; see below)

```bash
npm install
mkdir -p private && cp -R examples/data/* private/ && cp examples/env.example private/.env
```

1. **Fill in the settings.** In `private/.env`, set `ANTHROPIC_API_KEY`, `WA_BOT_PHONE` (the spare number) and `WA_GROUP_NAME` (your family group's exact name). Add the spare number to that group.
2. **Describe your occasion.** Edit `private/family.yaml` and the files under `private/holidays/`.
3. **Try it without sending anything.** These run messages through the real AI but don't send to WhatsApp or save anything:
   ```bash
   npm run hc -- simulate host "rsvp"
   ```
   ```bash
   npm run hc -- simulate "Aunt Sue" "what time should we get there?"
   ```
4. **Link WhatsApp.** Start the bot:
   ```bash
   npm run hc -- serve
   ```
   It prints an 8-character code. On the spare phone, go to WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead", and enter it.
5. **Text it `status`** from your own phone to check it's working.

### Keeping it running

On a Mac, install it as a background service. It starts at login, restarts if it crashes, keeps the Mac awake while the display sleeps, and logs to `private/logs/bot.log`:

```bash
npm run bot:install
```

`bot:status`, `bot:logs`, `bot:restart` (after changing code) and `bot:uninstall` manage it. If it's offline for a while, it catches up on messages from the last 3 days when it reconnects.

A MacBook still sleeps when its lid closes. To run it lid-closed while plugged in, `sudo pmset -a disablesleep 1` keeps it awake. Turn that off again with `0` after the occasion. An always-on machine such as a Raspberry Pi also works, and a home internet connection is safer for WhatsApp than a cloud server.

## What it costs

- **AI:** each message the bot answers is a short Claude conversation plus a quick screening check, so a few cents at most. A whole holiday's back-and-forth with a family is typically a few dollars.
- **Everything else:** WhatsApp is free. You need the spare number and a computer that stays on.

## How it's built

TypeScript on Node with no build step:
- `src/agent.ts`: the conversation logic, built on Claude tool use
- `src/guard.ts`: screening and limits
- `src/whatsapp.ts`: the Baileys connection
- `src/config.ts`: reading and writing your YAML files, preserving your comments
- `src/db.ts`: SQLite for messages, RSVPs and questions

```bash
npm test
```

The tests use stand-ins for Claude and WhatsApp, so they're free and work offline.

## Limitations

- **WhatsApp terms:** see the note at the top. A banned number would mean starting over with a new one.
- **One coordinator:** it's built around a single host texting commands.
- **Uptime:** replies only happen while the computer running it is on. Missed messages are caught up within 3 days.
- **Judgment:** the screening model can occasionally misjudge a message. Held messages come to you, and you can answer with `tell`.

## License

[MIT](LICENSE)
