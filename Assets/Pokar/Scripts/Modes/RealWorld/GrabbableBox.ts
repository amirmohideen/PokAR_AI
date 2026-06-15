import SIK from "SpectaclesInteractionKit.lspkg/SIK";
import TrackedHand, { PalmState } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand";
import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { VFXPool } from "./VFXPool";

import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

/**
 * GrabbableBox - Enables hand-grab interaction for a box object.
 * When a hand (left or right) gets close enough to the box, the box
 * follows that hand's palm position until released.
 * Also supports Interactable component for editor/indirect interactions.
 */

@component
export class GrabbableBox extends BaseScriptComponent {
    // Static list to track all active instances for collision detection
    public static activeBoxes: GrabbableBox[] = [];

    // Static tracking: which object each hand is currently grabbing (limit 1 per hand)
    private static leftHandGrabbing: GrabbableBox | null = null;
    private static rightHandGrabbing: GrabbableBox | null = null;

    @input
    @allowUndefined
    @hint("Distance threshold in cm for grabbing the box")
    grabDistance: number = 15;

    @input
    @allowUndefined
    @hint("Smoothing speed for box movement (higher = faster)")
    followSpeed: number = 12;

    @input
    @allowUndefined
    @hint("Minimum pinch strength to grab (0-1, higher = more intentional)")
    minPinchStrength: number = 0.7;

    @input
    @allowUndefined
    @hint("Speed threshold (cm/s) to START playing sound")
    soundTriggerSpeed: number = 5;

    @input
    @allowUndefined
    @hint("Speed threshold (cm/s) to STOP playing sound (lower than trigger for hysteresis)")
    soundStopSpeed: number = 2;

    @input
    @allowUndefined
    @hint("Minimum time (seconds) sound plays before it can stop")
    minSoundDuration: number = 0.8;

    @input
    @allowUndefined
    @hint("Cooldown in seconds between NEW sound triggers")
    soundCooldown: number = 0.5;

    @input
    @allowUndefined
    @hint("Velocity smoothing factor (0-1). Higher = more responsive, Lower = smoother")
    velocitySmoothing: number = 0.15;

    @input
    @allowUndefined
    @hint("Fade in duration for sound (seconds)")
    soundFadeIn: number = 0.25;

    @input
    @allowUndefined
    @hint("Fade out duration for sound (seconds)")
    soundFadeOut: number = 0.4;

    @input
    @allowUndefined
    @hint("Minimum volume at slow speed (0-1)")
    minVolume: number = 0.5;

    @input
    @allowUndefined
    @hint("Maximum volume at fast speed (0-1)")
    maxVolume: number = 1.0;

    @input
    @allowUndefined
    @hint("Speed (cm/s) at which volume reaches maximum")
    maxVolumeSpeed: number = 20;

    @input
    @allowUndefined
    @allowUndefined
    @hint("Separate Audio Component for collision sounds (to avoid interrupting velocity sounds)")
    collisionAudioComponent: AudioComponent;

    @input
    @allowUndefined
    @hint("Volume for collision sound (0-1)")
    collisionVolume: number = 0.6;

    @input
    @allowUndefined
    @hint("Audio Component for playing sound")
    audioComponent: AudioComponent;

    @input
    @allowUndefined
    @hint("Dynamic Audio Output for handling audio stream")
    dynamicAudioOutput: DynamicAudioOutput;

    @input
    @allowUndefined
    @allowUndefined
    @hint("Optional Interactable component - if present, will use its events for grab detection")
    interactable: Interactable;

    @input
    @allowUndefined
    @hint("Enable Interactable system for debugging (uses SIK manipulation instead of custom hand tracking)")
    useInteractableDebug: boolean = false;

    public labelObject: SceneObject | null = null;
    public frameObject: SceneObject | null = null;
    public dataPoint: any = null;

    // Assigned VFX objects (assigned once at creation)
    private myMovementVFX: SceneObject | null = null;
    private myCollisionVFX: SceneObject | null = null;
    private isMovementVFXActive: boolean = false;

    private transform: Transform;
    private handInputData: any;
    private leftHand: TrackedHand;
    private rightHand: TrackedHand;

    private isGrabbed: boolean = false;
    private grabbingHand: TrackedHand | null = null;
    private isInteractableGrabbed: boolean = false; // Track Interactable-based grab separately

    private worldCameraProvider: WorldCameraFinderProvider;
    private cameraTransform: Transform;

    // Velocity tracking
    private lastPosition: vec3 = vec3.zero();
    private lastSoundTime: number = 0;
    private smoothedSpeed: number = 0; // Exponentially smoothed velocity
    private soundStartTime: number = 0; // When current sound started playing
    private isSoundTriggeredByVelocity: boolean = false; // Track if sound is playing due to velocity
    private isFadingOut: boolean = false; // Prevent double fade-out calls

    // Collision tracking - Set of GrabbableBox instances we're currently colliding with
    private collidingWith: Set<GrabbableBox> = new Set();


    onAwake() {
        this.transform = this.getSceneObject().getTransform();
        this.worldCameraProvider = WorldCameraFinderProvider.getInstance();


        // Register this instance
        GrabbableBox.activeBoxes.push(this);

        this.createEvent("OnStartEvent").bind(() => {
            if (this.dynamicAudioOutput) {
                this.dynamicAudioOutput.initialize(48000);
            }
            this.onStart();
        });

        this.createEvent("OnDestroyEvent").bind(() => {
            // Clear the static tracker if this object was being grabbed
            if (GrabbableBox.leftHandGrabbing === this) {
                GrabbableBox.leftHandGrabbing = null;
            }
            if (GrabbableBox.rightHandGrabbing === this) {
                GrabbableBox.rightHandGrabbing = null;
            }

            // Remove this instance
            const index = GrabbableBox.activeBoxes.indexOf(this);
            if (index > -1) {
                GrabbableBox.activeBoxes.splice(index, 1);
            }
        });
    }

    private onStart() {
        // Get hand input data from SIK
        this.handInputData = SIK.HandInputData;
        this.leftHand = this.handInputData.getHand("left");
        this.rightHand = this.handInputData.getHand("right");

        // Get camera transform
        const cameraComponent = this.worldCameraProvider.getComponent();
        if (cameraComponent) {
            this.cameraTransform = cameraComponent.getSceneObject().getTransform();
        }

        // Assign VFX (once at creation)
        this.assignVFX();

        // Setup Interactable events if present
        this.setupInteractable();

        // Create update event for checking hand proximity and following
        this.createEvent("UpdateEvent").bind(() => {
            this.onUpdate();
        });
    }

    /**
     * Assign VFX objects from pool (called once at creation)
     */
    private assignVFX() {
        const vfxPool = VFXPool.getInstance();
        if (!vfxPool) return;

        this.myMovementVFX = vfxPool.assignMovementVFX();
        this.myCollisionVFX = vfxPool.assignCollisionVFX();

        // Set spawn to 0 initially
        if (this.myMovementVFX) {
            vfxPool.setSpawn(this.myMovementVFX, 0);
        }
        if (this.myCollisionVFX) {
            vfxPool.setSpawn(this.myCollisionVFX, 0);
        }
    }

    /**
     * Update VFX color - call this after dataPoint is set
     */
    public updateVFXColor() {
        const vfxPool = VFXPool.getInstance();
        if (!vfxPool) return;

        const color = this.dataPoint?.color || "#FFFFFF";
        if (this.myMovementVFX) {
            vfxPool.setColor(this.myMovementVFX, color);
        }
        if (this.myCollisionVFX) {
            vfxPool.setColor(this.myCollisionVFX, color);
        }
    }

    /**
     * Setup Interactable component events for grab detection
     */
    private setupInteractable() {
        // Try to find Interactable on this object if not assigned
        if (!this.interactable) {
            this.interactable = this.getSceneObject().getComponent(Interactable.getTypeName()) as Interactable;
        }

        // Find InteractableManipulation component
        const manipulation = this.getSceneObject().getComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;

        if (this.useInteractableDebug) {
            // DEBUG MODE: Use SIK's InteractableManipulation for movement
            if (manipulation) {
                manipulation.enabled = true;
            }
        } else {
            // NORMAL MODE: Disable InteractableManipulation, use custom hand tracking
            if (manipulation) {
                manipulation.enabled = false;
            }
        }

        if (!this.interactable) {
            return;
        }

        // Subscribe to trigger events (pinch/grab) - for velocity sound detection
        this.interactable.onTriggerStart.add((event) => {
            this.isInteractableGrabbed = true;
            this.isGrabbed = true;
            this.lastPosition = this.transform.getWorldPosition();
        });

        this.interactable.onTriggerEnd.add((event) => {
            // Call releaseGrab BEFORE setting flag to false (so fade condition works)
            if (!this.grabbingHand) {
                this.releaseGrab();
            }
            this.isInteractableGrabbed = false;
        });

        this.interactable.onTriggerCanceled.add((event) => {
            // Call releaseGrab BEFORE setting flag to false
            if (!this.grabbingHand) {
                this.releaseGrab();
            }
            this.isInteractableGrabbed = false;
        });
    }

    private onUpdate() {
        // Custom hand tracking (only when NOT in debug mode)
        if (!this.useInteractableDebug) {
            if (this.isGrabbed && this.grabbingHand) {
                // Currently grabbed by hand - follow the grabbing hand
                this.followHand();
            } else if (!this.isInteractableGrabbed) {
                // Not grabbed by hand or interactable - check for hand proximity to initiate grab
                this.checkForGrab();
            }
        }
        // In debug mode, InteractableManipulation handles movement

        // Check for collisions with other boxes
        this.checkCollisions();

        // Follow label position
        if (this.labelObject && this.cameraTransform) {
            // 1. Follow Position (since it's no longer a child)
            var currentBoxPos = this.transform.getWorldPosition();
            var offset = new vec3(0, 15, 0); // 15cm above center, adjust as needed based on scale
            // Alternatively, use box scale to determine offset
            var scale = this.transform.getWorldScale();
            // If scale is roughly width/height/depth.
            // Let's assume height is Y.
            offset = new vec3(0, scale.y / 2 + 5, 0); // Half height + 5cm padding

            this.labelObject.getTransform().setWorldPosition(currentBoxPos.add(offset));
        }

        // Update frame position to follow box
        if (this.frameObject) {
            this.frameObject.getTransform().setWorldPosition(this.transform.getWorldPosition());
        }

        // Velocity check for sound - works for both hand grab AND Interactable grab
        if (this.isGrabbed || this.isInteractableGrabbed) {
            var currentPos = this.transform.getWorldPosition();
            var dt = getDeltaTime();
            if (dt > 0) {
                var dist = currentPos.distance(this.lastPosition);
                var rawSpeed = dist / dt; // units per second (cm/s usually in LS)

                // Exponential smoothing to avoid glitches from frame-to-frame noise
                this.smoothedSpeed = this.smoothedSpeed + (rawSpeed - this.smoothedSpeed) * this.velocitySmoothing;

                var currentTime = getTime();

                // HYSTERESIS LOGIC:
                // - Start sound when speed > soundTriggerSpeed (higher threshold)
                // - Stop sound when speed < soundStopSpeed (lower threshold)
                // - This prevents rapid on/off switching near threshold

                if (this.isSoundTriggeredByVelocity && this.audioComponent && this.audioComponent.isPlaying()) {
                    // Sound is playing - check if we should stop it
                    var timePlaying = currentTime - this.soundStartTime;

                    // Update movement VFX position while sound is playing
                    this.updateMovementVFX();

                    // Update volume based on velocity
                    this.updateVolumeFromVelocity();

                    if (this.smoothedSpeed < this.soundStopSpeed && timePlaying > this.minSoundDuration) {
                        // Speed dropped below stop threshold AND played minimum duration
                        this.fadeOutCurrentSound();
                        this.stopMovementVFX();
                        this.isSoundTriggeredByVelocity = false;
                    }
                } else {
                    // Sound/VFX not playing - check if we should start
                    if (this.smoothedSpeed > this.soundTriggerSpeed && (currentTime - this.lastSoundTime > this.soundCooldown)) {
                        this.lastSoundTime = currentTime;
                        this.soundStartTime = currentTime;
                        this.isSoundTriggeredByVelocity = true;

                        // Start movement VFX (independent of sound)
                        this.startMovementVFX();

                        // Play audio if available
                        if (this.dataPoint && this.dataPoint.audioAsset) {
                            this.playAudio(this.dataPoint.audioAsset);
                        }
                    }
                }
            }
            this.lastPosition = currentPos;
        } else {
            // Keep last position updated to avoid huge jump when starting
            this.lastPosition = this.transform.getWorldPosition();
            // Reset smoothed speed when not grabbed
            this.smoothedSpeed = 0;

            // Fade out if sound was playing due to velocity
            if (this.isSoundTriggeredByVelocity) {
                this.fadeOutCurrentSound();
                this.stopMovementVFX();
                this.isSoundTriggeredByVelocity = false;
            }
        }
    }

    /**
     * Start movement VFX
     */
    private startMovementVFX() {
        if (!this.myMovementVFX || this.isMovementVFXActive) return;

        const vfxPool = VFXPool.getInstance();
        if (!vfxPool) return;

        this.isMovementVFXActive = true;
        const pos = this.transform.getWorldPosition();
        const myColor = this.dataPoint?.color || "#FFFFFF";
        vfxPool.setPosition(this.myMovementVFX, pos);
        vfxPool.setColor(this.myMovementVFX, myColor);
        vfxPool.setSpawn(this.myMovementVFX, 1);
    }

    /**
     * Update movement VFX position
     */
    private updateMovementVFX() {
        if (!this.myMovementVFX || !this.isMovementVFXActive) return;

        const vfxPool = VFXPool.getInstance();
        if (!vfxPool) return;

        const pos = this.transform.getWorldPosition();
        vfxPool.setPosition(this.myMovementVFX, pos);
    }

    /**
     * Stop movement VFX
     */
    private stopMovementVFX() {
        if (!this.myMovementVFX) return;

        const vfxPool = VFXPool.getInstance();
        if (vfxPool) {
            vfxPool.setSpawn(this.myMovementVFX, 0);
        }
        this.isMovementVFXActive = false;
    }

    /**
     * Update audio volume based on current velocity
     */
    private updateVolumeFromVelocity() {
        if (!this.audioComponent || !this.audioComponent.isPlaying()) return;
        this.audioComponent.volume = this.getVolumeFromVelocity();
    }

    /**
     * Fade out currently playing sound smoothly
     */
    private fadeOutCurrentSound() {
        // Prevent double fade-out calls
        if (this.isFadingOut) {
            return;
        }

        if (this.audioComponent && this.audioComponent.isPlaying()) {
            this.isFadingOut = true;
            this.audioComponent.fadeOutTime = this.soundFadeOut;
            this.audioComponent.stop(true); // true = use fade

            // Reset flag after fade completes
            const resetEvent = this.createEvent("DelayedCallbackEvent");
            resetEvent.bind(() => {
                this.isFadingOut = false;
            });
            resetEvent.reset(this.soundFadeOut + 0.1);
        }
    }

    private playAudio(asset: AudioTrackAsset) {
        if (this.audioComponent) {
            // Ensure audio pipeline is clear/ready
            if (this.dynamicAudioOutput) {
                this.dynamicAudioOutput.interruptAudioOutput();
            }

            this.audioComponent.enabled = true; // Ensure it's enabled

            // Fade out if already playing
            if (this.audioComponent.isPlaying()) {
                // Quick crossfade - fade out current, then fade in new
                this.audioComponent.fadeOutTime = this.soundFadeIn * 0.5; // Quick fade out
                this.audioComponent.stop(true); // true = use fade
                // Delay new playback slightly for smooth transition
                const delayEvent = this.createEvent("DelayedCallbackEvent");
                delayEvent.bind(() => {
                    this.playWithFadeIn(asset);
                });
                delayEvent.reset(this.soundFadeIn * 0.5 + 0.05);
            } else {
                this.playWithFadeIn(asset);
            }
        }
    }

    private playWithFadeIn(asset: AudioTrackAsset) {
        this.isFadingOut = false; // Reset fade-out flag when starting new sound
        this.audioComponent.audioTrack = asset;
        // Set initial volume based on current velocity
        this.audioComponent.volume = this.getVolumeFromVelocity();
        this.audioComponent.fadeInTime = this.soundFadeIn;
        this.audioComponent.play(1);
    }

    /**
     * Calculate volume based on current smoothed speed
     */
    private getVolumeFromVelocity(): number {
        const speedRange = this.maxVolumeSpeed - this.soundTriggerSpeed;
        const volumeRange = this.maxVolume - this.minVolume;

        let normalizedSpeed = (this.smoothedSpeed - this.soundTriggerSpeed) / speedRange;
        normalizedSpeed = Math.max(0, Math.min(1, normalizedSpeed)); // Clamp 0-1

        return this.minVolume + (normalizedSpeed * volumeRange);
    }

    public notifyAudioReady(asset: AudioTrackAsset) {
        if (this.dataPoint) {
            this.dataPoint.audioAsset = asset;
        }
    }

    /**
     * Public method to play this object's sound (e.g., from label button click)
     */
    public playObjectSound() {
        if (this.dataPoint && this.dataPoint.audioAsset) {
            this.playAudio(this.dataPoint.audioAsset);
        }
    }

    private checkCollisions() {
        var myPos = this.transform.getWorldPosition();
        var myScale = this.transform.getWorldScale();
        var myRadius = Math.max(myScale.x, myScale.y, myScale.z) * 0.5;

        // Track which boxes we're currently colliding with this frame
        const currentlyColliding: Set<GrabbableBox> = new Set();

        for (var otherBox of GrabbableBox.activeBoxes) {
            if (otherBox === this) continue;

            var otherPos = otherBox.getSceneObject().getTransform().getWorldPosition();
            var otherScale = otherBox.getSceneObject().getTransform().getWorldScale();
            var otherRadius = Math.max(otherScale.x, otherScale.y, otherScale.z) * 0.5;

            var dist = myPos.distance(otherPos);

            // Simple sphere collision check
            const isColliding = dist < (myRadius + otherRadius);

            if (isColliding) {
                currentlyColliding.add(otherBox);

                // Check if this is a NEW collision (wasn't colliding before)
                if (!this.collidingWith.has(otherBox)) {
                    // COLLISION ENTER - play sound!
                    this.onCollisionEnter(otherBox);
                }
            }
        }

        // Check for collision exits (was colliding, now isn't)
        for (const prevBox of this.collidingWith) {
            if (!currentlyColliding.has(prevBox)) {
                // COLLISION EXIT
                this.onCollisionExit(prevBox);
            }
        }

        // Update tracking set
        this.collidingWith = currentlyColliding;
    }

    /**
     * Called when this box starts colliding with another box
     */
    private onCollisionEnter(otherBox: GrabbableBox) {
        // Play collision sound (only from one side to avoid double sound)
        // Use instance comparison to ensure only one box plays the sound
        if (this.getInstanceId() < otherBox.getInstanceId()) {
            this.playCollisionSound();

            // Play collision VFX at collision midpoint
            this.playCollisionVFX(otherBox);
        }
    }

    /**
     * Play collision VFX at the midpoint between two colliding objects
     */
    private playCollisionVFX(otherBox: GrabbableBox) {
        const vfxPool = VFXPool.getInstance();
        if (!vfxPool) return;

        // Calculate collision position (midpoint between objects)
        const myPos = this.transform.getWorldPosition();
        const otherPos = otherBox.getSceneObject().getTransform().getWorldPosition();
        const collisionPos = myPos.add(otherPos).uniformScale(0.5);

        // Play my collision VFX
        if (this.myCollisionVFX) {
            const myColor = this.dataPoint?.color || "#FFFFFF";
            vfxPool.setPosition(this.myCollisionVFX, collisionPos);
            vfxPool.setColor(this.myCollisionVFX, myColor);
            vfxPool.setSpawn(this.myCollisionVFX, 1);
            // Auto-fade after 0.3s
            this.scheduleCollisionVFXStop(this.myCollisionVFX);
        }

        // Play other's collision VFX
        const otherVFX = otherBox.getCollisionVFX();
        if (otherVFX) {
            const otherColor = otherBox.dataPoint?.color || "#FFFFFF";
            vfxPool.setPosition(otherVFX, collisionPos);
            vfxPool.setColor(otherVFX, otherColor);
            vfxPool.setSpawn(otherVFX, 1);
            otherBox.scheduleCollisionVFXStop(otherVFX);
        }
    }

    /**
     * Schedule collision VFX to stop after delay
     */
    public scheduleCollisionVFXStop(vfx: SceneObject) {
        const delayEvent = this.createEvent("DelayedCallbackEvent");
        delayEvent.bind(() => {
            const vfxPool = VFXPool.getInstance();
            if (vfxPool && vfx) {
                vfxPool.setSpawn(vfx, 0);
            }
        });
        delayEvent.reset(0.3);
    }

    /**
     * Get collision VFX for external use
     */
    public getCollisionVFX(): SceneObject | null {
        return this.myCollisionVFX;
    }

    /**
     * Called when this box stops colliding with another box
     */
    private onCollisionExit(otherBox: GrabbableBox) {
        // Collision ended - could trigger exit effects here if needed
    }

    /**
     * Get a unique instance ID for this component (for collision sound deduplication)
     */
    private getInstanceId(): number {
        return GrabbableBox.activeBoxes.indexOf(this);
    }

    /**
     * Play the collision sound effect (generated)
     */
    private playCollisionSound() {
        // Only use generated collision sound from dataPoint
        const collisionAsset = this.dataPoint?.collisionAudioAsset;

        if (!collisionAsset) {
            // Sound not ready yet - just skip
            return;
        }

        // Use separate collision AudioComponent if available, otherwise fall back to main
        const audioComp = this.collisionAudioComponent || this.audioComponent;

        if (!audioComp) {
            return;
        }

        // For collision sounds, we want a quick "impact" feel
        audioComp.audioTrack = collisionAsset;
        audioComp.volume = this.collisionVolume;
        audioComp.fadeInTime = 0.02; // Very quick fade in for impact feel
        audioComp.fadeOutTime = 0.1;
        audioComp.play(1); // Play once
    }

    private checkForGrab() {
        // Check left hand - only if it's not already grabbing another object
        if (this.leftHand && this.leftHand.isTracked() &&
            GrabbableBox.leftHandGrabbing === null &&
            (this.leftHand.getPinchStrength() ?? 0) > this.minPinchStrength) {
            const indexTipPos = this.leftHand.indexTip.position;
            if (indexTipPos && this.isHandCloseEnough(indexTipPos)) {
                this.startGrab(this.leftHand, "left");
                return;
            }
        }

        // Check right hand - only if it's not already grabbing another object
        if (this.rightHand && this.rightHand.isTracked() &&
            GrabbableBox.rightHandGrabbing === null &&
            (this.rightHand.getPinchStrength() ?? 0) > this.minPinchStrength) {
            const indexTipPos = this.rightHand.indexTip.position;
            if (indexTipPos && this.isHandCloseEnough(indexTipPos)) {
                this.startGrab(this.rightHand, "right");
                return;
            }
        }
    }

    private isHandCloseEnough(handPosition: vec3): boolean {
        const boxPosition = this.transform.getWorldPosition();
        const distance = boxPosition.distance(handPosition);
        return distance <= this.grabDistance;
    }

    private startGrab(hand: TrackedHand, handSide: "left" | "right") {
        this.isGrabbed = true;
        this.grabbingHand = hand;

        // Register this object as being grabbed by this hand (limit 1 per hand)
        if (handSide === "left") {
            GrabbableBox.leftHandGrabbing = this;
        } else {
            GrabbableBox.rightHandGrabbing = this;
        }
    }

    private followHand() {
        if (!this.grabbingHand) {
            this.releaseGrab();
            return;
        }

        // Check if hand is still tracked
        if (!this.grabbingHand.isTracked()) {
            this.releaseGrab();
            return;
        }

        // Release if hand is flat (fully open)
        if (this.grabbingHand.palmState === PalmState.Flat) {
            this.releaseGrab();
            return;
        }

        // Get index finger tip position
        const indexTipPos = this.grabbingHand.indexTip.position;
        if (!indexTipPos) {
            this.releaseGrab();
            return;
        }

        // Check if hand has moved too far away (release threshold is 3x grab distance)
        const currentPos = this.transform.getWorldPosition();
        const distance = currentPos.distance(indexTipPos);
        if (distance > this.grabDistance * 3) {
            this.releaseGrab();
            return;
        }

        // Set box position directly to hand position (no lerp/attraction)
        this.transform.setWorldPosition(indexTipPos);
    }

    private releaseGrab() {
        if (this.isGrabbed || this.isInteractableGrabbed) {
            // Fade out audio when released (DON'T interrupt - let fade happen!)
            this.fadeOutCurrentSound();
            // Stop movement VFX immediately
            this.stopMovementVFX();
        }

        // Clear the static tracker so hand can grab another object
        if (GrabbableBox.leftHandGrabbing === this) {
            GrabbableBox.leftHandGrabbing = null;
        }
        if (GrabbableBox.rightHandGrabbing === this) {
            GrabbableBox.rightHandGrabbing = null;
        }

        this.isGrabbed = false;
        this.grabbingHand = null;
        this.smoothedSpeed = 0; // Reset smoothed velocity
        this.isSoundTriggeredByVelocity = false; // Reset flag to prevent double fade in onUpdate
    }
}
