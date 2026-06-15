import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput";

@component
export class MusicPlayer extends BaseScriptComponent {
  @input @allowUndefined private _dynamicAudioOutput: DynamicAudioOutput;
  @input @allowUndefined private _audioComponent: AudioComponent;
  private _onFinishCallback: () => void;
  private _wasPlaying: boolean = false;
  private _updateEvent: SceneEvent;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._dynamicAudioOutput.initialize(48000);
      // Set up finish callback on AudioComponent if provided
      if (this._audioComponent) {
        this._audioComponent.setOnFinish((audioComponent: AudioComponent) => {
          if (this._onFinishCallback) {
            this._onFinishCallback();
          }
        });
      }
      // Set up update event to check if audio finished
      this._updateEvent = this.createEvent("UpdateEvent");
      this._updateEvent.bind(() => this._checkAudioFinished());
    });
  }

  setOnFinish(callback: () => void) {
    this._onFinishCallback = callback;
  }

  isAudioPlaying(): boolean {
    return this._audioComponent && this._audioComponent.isPlaying();
  }

  playAudio(uint8Array: Uint8Array) {
    print("Playing audio from Uint8Array");
    this._dynamicAudioOutput.interruptAudioOutput();
    this._dynamicAudioOutput.addAudioFrame(uint8Array, 2);
    this._wasPlaying = true;
  }

  /**
   * Play audio from an AudioTrackAsset (loaded from URL) with fade in
   */
  playAudioTrack(audioAsset: AudioTrackAsset, fadeInDuration: number = 0.5) {
    print("Playing audio from AudioTrackAsset with fade in");

    if (!this._audioComponent) {
      print("Error: AudioComponent not configured");
      return;
    }

    // Stop currently playing audio with fade
    if (this._audioComponent.isPlaying()) {
      this._audioComponent.fadeOutTime = 0.2;
      this._audioComponent.stop(true); // true = use fade
      // Wait for fade out then play new track
      const delayEvent = this.createEvent("DelayedCallbackEvent");
      delayEvent.bind(() => {
        this._playWithFadeIn(audioAsset, fadeInDuration);
      });
      delayEvent.reset(0.25);
    } else {
      this._playWithFadeIn(audioAsset, fadeInDuration);
    }
  }

  private _playWithFadeIn(audioAsset: AudioTrackAsset, fadeInDuration: number) {
    this._audioComponent.audioTrack = audioAsset;
    this._audioComponent.volume = 0.8;
    this._audioComponent.fadeInTime = fadeInDuration;
    this._audioComponent.play(1);
    this._wasPlaying = true;
  }

  /**
   * Pause audio with fade out
   */
  pauseAudio(fadeOutDuration: number = 0.3) {
    print("Pausing audio with fade out");
    this._dynamicAudioOutput.interruptAudioOutput();
    if (this._audioComponent && this._audioComponent.isPlaying()) {
      this._audioComponent.fadeOutTime = fadeOutDuration;
      this._audioComponent.stop(true); // true = use fade
    }
    this._wasPlaying = false;
  }

  private _checkAudioFinished() {
    // Check if audio was playing but AudioComponent stopped
    if (this._wasPlaying && this._audioComponent) {
      if (!this._audioComponent.isPlaying()) {
        // Audio finished playing
        if (this._onFinishCallback) {
          this._onFinishCallback();
        }
        this._wasPlaying = false;
      }
    }
  }
}
