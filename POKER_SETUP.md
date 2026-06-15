# AR Poker Assistant — Setup & Wiring Guide

This document covers everything built and the manual steps to finish wiring it in
Lens Studio. The **scripting architecture is complete and compiles with zero errors**;
what remains is connecting `@input` references and creating the visual content
(card/chip/button art), which must be done in the editor.

---

## 1. What was built

### Packages installed
- **RemoteServiceGateway** (+ Token Generator plugin) — Gemini Vision
- **SpectaclesSyncKit** — Connected Lenses multiplayer
- **Utilities**, **SnapDecorators** — RSG/SyncKit dependencies
- (SpectaclesInteractionKit + SpectaclesUIKit were already present)

### Archived (previous work) → `archive/`
- `archive/lens-scripts/` — CardDetector, CardDetector_RAW, CaptureSession
- `archive/backend/` — the Node benchmark backend

### New scripts → `Assets/Pokar/Scripts/`
```
Core/
  CardData.ts          Pure model: Rank/Suit/Card/Deck, code parsing ("Ah","Td")
  HandEvaluator.ts     Mock Monte Carlo win% (real 5-card category ranking)
  CardView.ts          Procedural face/back + animated flip
  CardInteraction.ts   SIK grab → animated snap-back to slot
  TableLayout.ts       Hand/field/pot/deck slot anchors
  BetController.ts      Drag-chip-to-bet + pot/stack tracking
  ActionButtons.ts     Fold / Call / Raise PinchButtons
  GameManager.ts       Mode switch + shared deck/pot state
Modes/SinglePlayer/
  VoiceCommandListener.ts   ASR — "how good is my hand?"
  HandStrengthHUD.ts        Floating win% HUD
  SinglePlayerController.ts Deals hand, runs evaluator on voice query
Modes/Multiplayer/
  SyncedCard.ts             SyncEntity: position/rotation/faceUp
  PotSync.ts                SyncEntity: shared pot total
  PokerSessionManager.ts    Connected Lenses roster (P2P)
Modes/RealWorld/
  GeminiCardVision.ts       Camera → Gemini → strict JSON + STATE BUFFER
  HandStrengthBarometer.ts  Left-hand-anchored win% barometer
```

### Scene hierarchy created
```
PokAR
├── GameManager            [GameManager]
├── Table
│   ├── BetController       [BetController]
│   ├── ActionButtons       [ActionButtons]
│   └── TableLayout         [TableLayout]
├── SinglePlayer           (enabled by default)
│   ├── SinglePlayerController [SinglePlayerController]
│   ├── VoiceCommandListener   [VoiceCommandListener]
│   └── HandStrengthHUD        [HandStrengthHUD]
├── Multiplayer            (disabled)
│   ├── PokerSessionManager [PokerSessionManager]
│   └── PotSync             [PotSync]
└── RealWorld              (disabled)
    ├── RSGCredentials      [RemoteServiceGatewayCredentials]
    ├── GeminiCardVision    [GeminiCardVision]
    └── HandStrengthBarometer [HandStrengthBarometer]
```
All 12 script components are attached and bound to their scripts.

---

## 2. FIRST: reload the project

The scripts were attached programmatically (via MCP), so their `@input` fields may
not yet appear in the Inspector. **Reload the project** (or right-click each script
asset → Refresh) so Lens Studio materializes the inputs. After reload, the inputs
listed below will be assignable.

---

## 3. Remote Service Gateway token (Real-World / Gemini mode)

1. In Lens Studio, open the **Remote Service Gateway Token Generator** plugin
   (Window menu, installed by this build).
2. Generate a token and copy it.
3. Select **PokAR → RealWorld → RSGCredentials** and paste the token into the
   **Google token** field (the `googleToken` input on RemoteServiceGatewayCredentials).
4. Project Settings → **Extended Permissions** → enable (camera + internet together).
   Note: lenses with Extended Permissions cannot be published publicly.

---

## 4. Inter-script references to assign (after reload)

MCP could not set these until the inputs materialize. Assign in the Inspector:

| Component | Input | Drag in |
|-----------|-------|---------|
| GameManager | singlePlayerRoot | `SinglePlayer` object |
| GameManager | multiplayerRoot | `Multiplayer` object |
| GameManager | realWorldRoot | `RealWorld` object |
| GameManager | betController | `BetController` |
| GameManager | startMode | choose Single Player |
| ActionButtons | betController | `BetController` |
| SinglePlayerController | voiceListener | `VoiceCommandListener` |
| SinglePlayerController | hud | `HandStrengthHUD` |
| PotSync | betController | `BetController` |
| HandStrengthBarometer | vision | `GeminiCardVision` |

(GeminiCardVision needs no references — just the token + the `model`/`interval` inputs already defaulted.)

---

## 5. Content you still need to create (art + prefabs)

The logic is done; these need visual objects/meshes, so build them in the editor.

### Card prefab (used by all modes)
A card object with:
- `frontRoot` child (white quad) + up to 4 corner **Text** components (assign to CardView.cornerTexts)
- `backRoot` child (shared generic back texture)
- **Collider** + SIK **Interactable** + **InteractableManipulation**
- **CardView** component (assign frontRoot/backRoot/cornerTexts)
- **CardInteraction** component (assign manipulation; homeSlot set at runtime or in editor)
- For multiplayer, also add **SyncedCard** (assign its CardView) and make it an
  Instantiator prefab.

### Chips
- A cylinder mesh for the **bet chip** with InteractableManipulation → assign to
  `BetController.betChip`. Add more cylinders of different colors for visual denominations.

### Action buttons
- Three button objects each with a SIK **PinchButton** → assign to ActionButtons
  foldButton / callButton / raiseButton. (SpectaclesUIKit has ready-made button prefabs.)

### Text displays
- Bet/Pot **Text** → BetController.betText / potText
- HUD **Text** (percent + category) → HandStrengthHUD.percentText / categoryText,
  and a fill-bar object for the barometer.

### Table slots
- Empty anchor objects for hand (2) / field (5) / pot / deck → TableLayout inputs.
- Assign hole/field card CardViews to SinglePlayerController.holeCardViews / fieldCardViews.

### Multiplayer session (required for Connected Lenses)
- Add the **SpectaclesSyncKit** session prefab to the scene (it bootstraps the
  ConnectedLensModule + SessionController that PokerSessionManager/SyncedCard/PotSync use).
  Without it, multiplayer scripts no-op gracefully.

---

## 6. On-device testing notes

- **Hand tracking, ASR, depth, Connected Lenses, and Gemini do not fully run in
  Editor Preview** — deploy to Spectacles.
- **Single-Player**: say "how good is my hand?" → HUD shows win% (mock Monte Carlo).
- **Real-World**: point at real cards; the **state buffer** keeps the last valid
  reading when a frame is empty/occluded — only ≥1 recognized card updates it.
- **Multiplayer**: needs 2 paired Spectacles in the same Connected Lens session.

---

## 7. Mode switching

`GameManager.setMode(GameMode.SinglePlayer | Multiplayer | RealWorld)` enables exactly
one mode subtree. Default is set via the `startMode` input. To add a start menu, wire
3 PinchButtons to call `setMode(...)`.
