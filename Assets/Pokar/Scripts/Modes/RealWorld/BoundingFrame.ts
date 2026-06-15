import animate, { CancelSet } from "SpectaclesInteractionKit.lspkg/Utils/animate";

/**
 * BoundingFrame - Controls a plane that acts as a bounding box frame around detected objects.
 * The frame is positioned at the center of the detected object and scaled to match the bounding box size.
 * Animates scale smoothly when appearing.
 */

@component
export class BoundingFrame extends BaseScriptComponent {
    @input
    @allowUndefined
    @hint("Offset above the target object center")
    verticalOffset: number = 0;

    @input
    @allowUndefined
    @hint("Duration of scale animation in seconds")
    animationDuration: number = 0.4;

    // Set programmatically via setTarget()
    private targetObject: SceneObject | null = null;

    private transform: Transform;
    private targetTransform: Transform | null = null;
    private targetScale: vec3 = vec3.one();
    private cancelSet: CancelSet = new CancelSet();

    onAwake() {
        this.transform = this.getSceneObject().getTransform();
        // Start with zero scale
        this.transform.setLocalScale(vec3.zero());

        this.createEvent("OnStartEvent").bind(() => {
            this.onStart();
        });
    }

    private onStart() {
        // Create update event to follow target
        this.createEvent("UpdateEvent").bind(() => {
            this.onUpdate();
        });
    }

    private onUpdate() {
        if (!this.targetTransform) return;

        // Follow target position
        const targetPos = this.targetTransform.getWorldPosition();
        const newPos = new vec3(targetPos.x, targetPos.y + this.verticalOffset, targetPos.z);
        this.transform.setWorldPosition(newPos);

        // Note: Rotation is handled by LookAt component on the prefab
    }

    /**
     * Set the target object to follow
     */
    public setTarget(target: SceneObject) {
        this.targetObject = target;
        if (target) {
            this.targetTransform = target.getTransform();
        }
    }

    /**
     * Set frame size with smooth animation
     * @param width - Width in world units (cm)
     * @param height - Height in world units (cm)
     */
    public setSize(width: number, height: number) {
        // Plane mesh is 0.01 units, original prefab uses scale 100 to make it 1 unit
        // So we need to multiply by 100 to convert cm to proper scale
        // Also: Plane has rotation -90 on X, so Y and Z are swapped
        // X = width, Y = thickness, Z = height
        const scaleFactor = 1.5; // Compensate for small mesh
        this.targetScale = new vec3(width * scaleFactor, 1, height * scaleFactor);
        this.animateScaleIn();
    }

    /**
     * Animate scale from 0 to target size
     */
    private animateScaleIn() {
        // Cancel any existing animation
        this.cancelSet.cancel();

        const startScale = vec3.zero();
        const endScale = this.targetScale;

        animate({
            cancelSet: this.cancelSet,
            duration: this.animationDuration,
            easing: "ease-out-back",
            update: (t: number) => {
                const currentScale = vec3.lerp(startScale, endScale, t);
                this.transform.setLocalScale(currentScale);
            }
        });
    }

    /**
     * Animate scale out (for hiding)
     */
    public animateScaleOut(onComplete?: () => void) {
        this.cancelSet.cancel();

        const startScale = this.transform.getLocalScale();
        const endScale = vec3.zero();

        animate({
            cancelSet: this.cancelSet,
            duration: this.animationDuration * 0.5,
            easing: "ease-in-quad",
            update: (t: number) => {
                const currentScale = vec3.lerp(startScale, endScale, t);
                this.transform.setLocalScale(currentScale);
            },
            ended: () => {
                if (onComplete) onComplete();
            }
        });
    }

    /**
     * Set frame size directly from bounding box world positions
     */
    public setSizeFromBounds(topLeft: vec3, bottomRight: vec3, topRight: vec3, bottomLeft: vec3) {
        const width = topLeft.distance(topRight);
        const height = topLeft.distance(bottomLeft);
        this.setSize(width, height);
    }

    /**
     * Set frame color from hex string
     * @param hexColor - Color in hex format (e.g., "#FF0000" for red)
     */
    public setColor(hexColor: string) {
        // Parse hex color
        const color = this.hexToColor(hexColor);
        if (!color) {
            return;
        }

        // Get RenderMeshVisual directly from this object
        const rmv = this.getSceneObject().getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        if (rmv) {
            // Clone material to avoid affecting other instances
            const material = rmv.mainMaterial.clone();

            // Set baseColor pass
            material.mainPass.baseColor = color;

            // Apply cloned material
            rmv.mainMaterial = material;
        }
    }

    /**
     * Convert hex color string to vec4 color
     */
    private hexToColor(hex: string): vec4 | null {
        // Remove # if present
        hex = hex.replace("#", "");

        if (hex.length !== 6) {
            return null;
        }

        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;

        return new vec4(r, g, b, 1.0);
    }
}
