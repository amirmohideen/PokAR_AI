# PokAR 🃏

**Learn poker by playing it — with Snap Spectacles as your personal AI coach.**

PokAR turns Spectacles into a hands-on Texas Hold'em coach. Practice heads-up against a CPU with a live win-% readout, then sit down at a real table and let on-device simulation + Google Gemini read the cards and coach you through every hand.

---

## 🎬 Trailer

<!-- Add your trailer / demo video here -->

> **▶️ Watch the trailer:

<!--
Embed options:
- A thumbnail image linking to YouTube:
  [![PokAR Trailer](path/to/thumbnail.png)](https://youtube.com/your-video)
- Or drag-and-drop an MP4 directly into the GitHub README editor.
-->



https://github.com/user-attachments/assets/b937b3a3-2ced-41b4-9558-1c631848c2db



---

## ✨ Why PokAR?

Everyone who's tried to learn poker hears the same thing:

> _"You won't learn poker until you play it."_

But playing to learn is intimidating and expensive — especially with experienced players at the table. PokAR puts a coach right there with you on every hand, showing your odds and helping you build real instincts. It brings a beginner up to speed fast, while still being useful to a casual player sharpening their reads.

---

## 🎮 What it does

PokAR is a Texas Hold'em coach with two distinct modes.

### 🎓 Single Player Mode (Tutorial)
- Heads-up Texas Hold'em against a CPU opponent.
- Two hole cards dealt face-down — grab and peek at them with your hands, just like real cards.
- Gesture-driven **Fold / Call / Raise** buttons.
- Streets advance naturally: **Flop → Turn → River → Showdown**, best 5-card hand takes the pot.
- A palm-side hand menu shows your **live win %** every step of the way, powered by an on-device Monte Carlo evaluator — so you start to *feel* what a good hand looks like.
- Bet by **pinching a chip and pulling up** to physically stack your wager. On a raise, chips animate flying into the pot.

### 👁️ Live Mode (Real World)
- Sit at an actual poker table with real cards and chips.
- Spectacles captures the scene and sends it to **Google Gemini**, which reads your hole cards and the community cards.
- Win probability is simulated locally and surfaced big and clear, with a one-line read on your hand.
- An **Auto-Capture** toggle keeps odds updating continuously, or hit **Capture** to analyze a single moment on demand — perfect for re-checking after each new card.

---

## 🛠️ How it's built

| Layer | Tech |
|-------|------|
| **Platform** | Snap Spectacles + Lens Studio (TypeScript) |
| **Interaction** | SpectaclesInteractionKit (pinch, grab, manipulate) + SpectaclesUIKit (buttons, switches) |
| **AI vision** | Google Gemini via the Remote Service Gateway — reads real-world cards and returns structured card data |
| **Poker brain** | A custom Monte Carlo `HandEvaluator` that simulates win probability on-device from any set of hole/community cards. Drives both the CPU opponent and the live win-% readout. |
| **Architecture** | A shared `GameManager` enables exactly one mode at a time, with dedicated controllers for Single Player, Live/Real-World, and an in-progress Multiplayer layer (synced session, pot, and cards). |

### Project layout
```
Assets/Pokar/Scripts/
  Core/                 Shared model + UI
    CardData.ts           Rank/Suit/Card/Deck model + code parsing
    HandEvaluator.ts      Monte Carlo win-% engine
    GameManager.ts        Mode switching + shared deck/pot state
    BetController.ts      Drag-chip-to-bet + pot/stack tracking
    ActionButtons.ts      Fold / Call / Raise controls
    HandStrengthMenu.ts   Palm-side live win-% menu
    ... (CardView, CardInteraction, TableLayout, MainMenu, etc.)
  Modes/SinglePlayer/
    SinglePlayerController.ts   Deals hands, runs the CPU + evaluator
    HandStrengthHUD.ts          Floating win-% HUD
  Modes/RealWorld/
    GeminiAPI.ts          Camera capture → Gemini card reads
    SceneController.ts    Live mode orchestration
    ResponseUI.ts         Win-% + hand read display
    ... (capture, labels, VFX, depth, music)
  Modes/Multiplayer/      (in progress)
    PokerSessionManager.ts, PotSync.ts, SyncedCard.ts
```

---

## 🚀 Getting started

> Requires **Lens Studio** and a pair of **Snap Spectacles**.

1. Clone this repository and open `PokAR_AIAgent.esproj` in Lens Studio.
2. Configure the **Remote Service Gateway** credentials so Gemini calls can be made (Live Mode).
3. Follow [`POKER_SETUP.md`](POKER_SETUP.md) for the detailed wiring guide — connecting `@input` references and the card/chip/button visuals in the editor.
4. Push to your Spectacles to play.

---

## 🧗 Challenges we ran into
- **Team collaboration on a Lens Studio project.** The project format doesn't play nicely with git out of the box — merge conflicts and stale project-lock files blocked teammates from even opening the project, so we built a clean sharing workflow.
- **Gemini card recognition.** Reliable, structured card reads from a live feed took real iteration on the prompt and capture pipeline (frame timing, camera settle, request throttling). The lesson: Gemini is excellent when you give it a clean enough input.
- **Merging two modes into one coherent app** without them stepping on each other's scene state.

## 🏆 What we're proud of
- A functioning poker game with **two fully distinct modes** — a CPU tutorial and a live AI-coached table — in a very short build.
- Made poker genuinely **approachable**: a real-time win % that teaches you the game *while* you play.
- Natural, physical interactions — peeking at cards, stacking chips to bet — that feel like real poker, not a menu.

## 📚 What we learned
- **Gemini is remarkably capable when fed a good capture.** Most of our "AI problem" was actually an input problem.
- **AR + AI is a phenomenal way to gamify complex skills.** Layering live coaching onto a real-world activity makes something intimidating feel learnable and a lot more fun. Poker is just the first example.

## 🔮 What's next
- **Polishing both modes:** smoother CPU play, better card recognition, deeper coaching.
- **Full Multiplayer Mode:** a shared session with a synced timer and synchronized pot/cards across players.
- **Broadcasting gameplay** to web dashboards and spectator views, so a live PokAR table can be followed from anywhere.

---

<p align="center">Built with ♠️ ♥️ ♣️ ♦️ on Snap Spectacles.</p>
