import { GeminiAPI } from "./GeminiAPI";
import { SpeechUI } from "./SpeechUI";
import { ResponseUI } from "./ResponseUI";
import { Loading } from "./Loading";
import { DepthCache } from "./DepthCache";
import { DebugVisualizer } from "./DebugVisualizer";
import { Card } from "../../Core/CardData";
import { HandEvaluator } from "../../Core/HandEvaluator";
import { HandStrengthMenu } from "../../Core/HandStrengthMenu";
import { Switch } from "SpectaclesUIKit.lspkg/Scripts/Components/Switch/Switch";
import { CapsuleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/CapsuleButton";

/**
 * Poker play mode.
 *
 * Pinch the bubble to capture the scene through the Spectacles camera. The frame
 * (your two hole cards + the community cards on the table) is sent to Gemini, which
 * estimates your probability of winning the hand. The percentage is shown big, with a
 * one-line summary. Pinch again any time a new card is revealed (after a check) to
 * re-analyze with the updated board.
 *
 * No object spawning, VFX, sound effects, music, or world markers — just the odds.
 */
@component
export class SceneController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Show debug visuals in the scene")
  showDebugVisuals: boolean = false;
  @input
  @allowUndefined
  @hint("Visualizes the captured camera frame for debugging")
  debugVisualizer: DebugVisualizer;
  @input
  @allowUndefined
  @hint("Handles the pinch bubble UI")
  speechUI: SpeechUI;
  @input
  @allowUndefined
  @hint("Calls the Gemini API for poker analysis")
  gemini: GeminiAPI;
  @input
  @allowUndefined
  @hint("Displays the analysis result text")
  responseUI: ResponseUI;
  @input
  @allowUndefined
  @hint("Loading visual")
  loading: Loading;
  @input
  @allowUndefined
  @hint("Caches the camera frame for capture")
  depthCache: DepthCache;
  @input
  @allowUndefined
  @hint("Main status text (shows the win percentage)")
  speechText: Text;
  @input
  @allowUndefined
  @hint("Palm hand-menu that shows the live win %.")
  handMenu: HandStrengthMenu;

  @input
  @hint("Start with continuous auto-capture enabled. The in-scene Auto-Capture switch can override this at runtime.")
  autoCapture: boolean = true;
  @input
  @hint("Seconds between auto-captures (camera settle + API throttle). Only used when auto-capture is on.")
  captureDelay: number = 0.4;
  @input
  @allowUndefined
  @hint("In-scene Auto-Capture On/Off switch (SpectaclesUIKit Switch).")
  autoCaptureSwitch: Switch;
  @input
  @allowUndefined
  @hint("Manual Capture button — captures one frame regardless of the auto-capture toggle.")
  captureButton: CapsuleButton;

  private isRequestRunning = false;
  private modeActive = false;

  // Monte Carlo draws used to simulate the win % from the detected cards.
  private samples: number = 100;

  onAwake() {
    // The mode is "active" whenever this root is enabled; it stops when disabled
    // (player returns to the main menu). While active, capture is either continuous
    // (auto-capture on) or on-demand via the Capture button.
    this.createEvent("OnStartEvent").bind(this.onStart.bind(this));
    this.createEvent("OnEnableEvent").bind(() => this.startScanning());
    this.createEvent("OnDisableEvent").bind(() => this.stopScanning());
  }

  onStart() {
    // First activation (OnStart fires once the object is actually active). OnEnable
    // also calls this on re-entry; startScanning() is guarded against double-starts.
    this.wireControls();
    this.startScanning();
  }

  /** Hook up the in-scene Auto-Capture switch and manual Capture button. */
  private wireControls() {
    if (this.autoCaptureSwitch) {
      // onInitialized is a replay event: fires immediately if already set up.
      this.autoCaptureSwitch.onInitialized.add(() => {
        // Reflect the inspector default on the switch, then listen for changes.
        this.autoCaptureSwitch.isOn = this.autoCapture;
        this.autoCaptureSwitch.onValueChange.add((v: number) =>
          this.setAutoCapture(v > 0),
        );
      });
    }
    if (this.captureButton) {
      this.captureButton.onInitialized.add(() =>
        this.captureButton.onTriggerUp.add(() => this.captureOnce()),
      );
    }
  }

  /** Enter the mode: show UI; begin the auto-capture loop if it's enabled. */
  private startScanning() {
    if (this.modeActive) return;
    this.modeActive = true;
    if (this.speechUI) this.speechUI.showSpeechBubble();
    if (this.handMenu) this.handMenu.setActive(true);
    this.speechText.text = this.autoCapture
      ? "Scanning your cards..."
      : "Tap Capture to analyze";
    if (this.autoCapture) this.captureOnce();
  }

  /** Leave the mode and hide the hand menu. */
  private stopScanning() {
    this.modeActive = false;
    this.isRequestRunning = false;
    if (this.handMenu) this.handMenu.setActive(false);
  }

  /** Turn auto-capture on/off at runtime (from the in-scene switch). */
  private setAutoCapture(on: boolean) {
    if (on === this.autoCapture) return;
    this.autoCapture = on;
    if (on) {
      this.speechText.text = "Scanning your cards...";
      // Resume the loop immediately if the mode is active and idle.
      if (this.modeActive && !this.isRequestRunning) this.captureOnce();
    } else {
      this.speechText.text = "Tap Capture to analyze";
      // Any pending DelayedCallbackEvent self-cancels via the autoCapture check.
    }
  }

  /**
   * Capture one frame and send it to Gemini. Used by both the auto-capture loop
   * and the manual Capture button, so it runs regardless of the auto toggle —
   * it only needs the mode active and no request already in flight. When the
   * response lands it reschedules itself *only* if auto-capture is on.
   */
  private captureOnce() {
    if (!this.modeActive || this.isRequestRunning) return;

    const depthFrameID = this.depthCache.saveDepthFrame();
    if (depthFrameID === -1) {
      this.scheduleNext();
      return;
    }
    const camImage = this.depthCache.getCamImageWithID(depthFrameID);
    if (camImage == null) {
      this.depthCache.disposeDepthFrame(depthFrameID);
      this.scheduleNext();
      return;
    }

    if (this.showDebugVisuals && this.debugVisualizer) {
      this.debugVisualizer.updateCameraFrame(camImage);
    }

    this.isRequestRunning = true;
    this.gemini.makePokerRequest(camImage, (response) => {
      this.depthCache.disposeDepthFrame(depthFrameID);
      this.isRequestRunning = false;
      if (this.modeActive) {
        this.showPokerResult(response);
        this.scheduleNext();
      }
    });
  }

  /** Queue the next auto-capture after the settle delay (no-op when auto is off). */
  private scheduleNext() {
    if (!this.modeActive || !this.autoCapture) return;
    const ev = this.createEvent("DelayedCallbackEvent");
    // Re-check autoCapture at fire time so toggling off cancels a pending scan.
    ev.bind(() => {
      if (this.autoCapture) this.captureOnce();
    });
    ev.reset(this.captureDelay);
  }

  /**
   * Parse Gemini's detected cards, simulate the win % locally (same engine as
   * Single-Player), and drive the status text + palm hand menu. No markers/sounds.
   */
  private showPokerResult(response: {
    winProbability: number;
    holeCards: string[];
    communityCards: string[];
    handLabel: string;
    message: string;
  }) {
    const holeCodes = response.holeCards || [];
    const communityCodes = response.communityCards || [];

    // Debug: log exactly what Gemini detected this frame.
    print(
      "[Poker] Gemini detected — hole: [" +
        holeCodes.join(", ") +
        "]  community: [" +
        communityCodes.join(", ") +
        "]",
    );

    const hole = holeCodes.map((c) => Card.parse(c)).filter((c) => !!c) as Card[];
    const community = communityCodes
      .map((c) => Card.parse(c))
      .filter((c) => !!c) as Card[];

    if (hole.length < 2) {
      // Couldn't read the two hole cards this frame — keep scanning.
      this.speechText.text = "Show me your cards";
      if (this.handMenu) this.handMenu.clear();
      this.responseUI.openResponseBubble(
        response.message || "Hold up your two cards and the table cards.",
      );
      return;
    }

    // Simulate the win % locally from the detected cards (100 random draws vs a
    // random opponent) — the same HandEvaluator Single-Player uses.
    const sim = HandEvaluator.estimateWinProbability(hole, community, this.samples);
    const pct = Math.round(sim.winProbability * 100);
    this.speechText.text = pct + "%  win chance";
    if (this.handMenu) this.handMenu.setStrengthValue(pct, sim.categoryName);

    // Build a short detail line for the response bubble.
    let detail = "";
    if (sim.categoryName) {
      detail += sim.categoryName + ". ";
    }
    if (response.message) {
      detail += response.message;
    }
    const cards = this.formatCards(response.holeCards, response.communityCards);
    if (cards) {
      detail += "\n" + cards;
    }
    this.responseUI.openResponseBubble(detail.trim());
  }

  private formatCards(holeCards: string[], communityCards: string[]): string {
    const parts: string[] = [];
    if (holeCards && holeCards.length > 0) {
      parts.push("Hand: " + holeCards.join(" "));
    }
    if (communityCards && communityCards.length > 0) {
      parts.push("Table: " + communityCards.join(" "));
    }
    return parts.join("   ");
  }
}
