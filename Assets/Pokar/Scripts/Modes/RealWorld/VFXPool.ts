/**
 * VFXPool - Simple VFX manager
 *
 * Each GrabbableBox gets assigned its own VFX instances at creation.
 * No random selection, no complex pooling - just direct assignment.
 */

@component
export class VFXPool extends BaseScriptComponent {
    private static instance: VFXPool;

    // VFX arrays
    private movementVFXList: SceneObject[] = [];
    private collisionVFXList: SceneObject[] = [];

    // Assignment counters
    private nextMovementIndex: number = 0;
    private nextCollisionIndex: number = 0;

    onAwake() {
        VFXPool.instance = this;

        this.createEvent("OnStartEvent").bind(() => {
            this.initializeVFX();
        });
    }

    public static getInstance(): VFXPool {
        return VFXPool.instance;
    }

    private initializeVFX() {
        const myObject = this.getSceneObject();

        // Find containers
        const movementContainer = this.findChildByName(myObject, "SpawnVFXContainer");
        const collisionContainer = this.findChildByName(myObject, "collisionVFXContainer");

        // Collect movement VFX
        if (movementContainer) {
            const count = movementContainer.getChildrenCount();
            for (let i = 0; i < count; i++) {
                const child = movementContainer.getChild(i);
                this.movementVFXList.push(child);
                // Set spawn to 0 initially
                this.setSpawn(child, 0);
            }
        }

        // Collect collision VFX
        if (collisionContainer) {
            const count = collisionContainer.getChildrenCount();
            for (let i = 0; i < count; i++) {
                const child = collisionContainer.getChild(i);
                this.collisionVFXList.push(child);
                // Set spawn to 0 initially
                this.setSpawn(child, 0);
            }
        }
    }

    private findChildByName(parent: SceneObject, name: string): SceneObject | null {
        const count = parent.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = parent.getChild(i);
            if (child.name === name) return child;
        }
        return null;
    }

    /**
     * Assign a movement VFX to an object. Call once at creation.
     * Returns the VFX SceneObject that belongs to this object.
     */
    public assignMovementVFX(): SceneObject | null {
        if (this.movementVFXList.length === 0) return null;

        const index = this.nextMovementIndex % this.movementVFXList.length;
        this.nextMovementIndex++;

        const vfx = this.movementVFXList[index];
        return vfx;
    }

    /**
     * Assign a collision VFX to an object. Call once at creation.
     */
    public assignCollisionVFX(): SceneObject | null {
        if (this.collisionVFXList.length === 0) return null;

        const index = this.nextCollisionIndex % this.collisionVFXList.length;
        this.nextCollisionIndex++;

        const vfx = this.collisionVFXList[index];
        return vfx;
    }

    /**
     * Play spawn VFX at position (for initial object spawn)
     * Uses a movement VFX temporarily
     */
    public playSpawnVFX(position: vec3, color: string, onComplete?: () => void) {
        // Use next available movement VFX for spawn effect
        if (this.movementVFXList.length === 0) {
            if (onComplete) onComplete();
            return;
        }

        const index = this.nextMovementIndex % this.movementVFXList.length;
        const vfx = this.movementVFXList[index];

        this.setPosition(vfx, position);
        this.setColor(vfx, color);
        this.setSpawn(vfx, 1);

        // Stop after 0.5 seconds
        const delayEvent = this.createEvent("DelayedCallbackEvent");
        delayEvent.bind(() => {
            this.setSpawn(vfx, 0);
            if (onComplete) onComplete();
        });
        delayEvent.reset(0.5);
    }

    /**
     * Set VFX spawn value (0 = off, 1 = full)
     */
    public setSpawn(vfxObject: SceneObject, value: number) {
        const vfxComp = this.getVFXComponent(vfxObject);
        if (vfxComp && vfxComp.asset && vfxComp.asset.properties) {
            vfxComp.asset.properties["spawn"] = value;
        }
    }

    /**
     * Set VFX color
     */
    public setColor(vfxObject: SceneObject, hexColor: string) {
        if (!vfxObject) return;

        const vfxComp = this.getVFXComponent(vfxObject);
        if (!vfxComp || !vfxComp.asset) return;

        const hex = hexColor.replace("#", "");
        if (hex.length !== 6) return;

        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;

        const color = new vec4(r, g, b, 1.0);

        if (vfxComp.asset.properties) {
            vfxComp.asset.properties["baseColor"] = color;
        }
    }

    /**
     * Move VFX to position
     */
    public setPosition(vfxObject: SceneObject, position: vec3) {
        vfxObject.getTransform().setWorldPosition(position);
    }

    private getVFXComponent(obj: SceneObject): any {
        let comp = obj.getComponent("Component.VFXComponent");
        if (comp) return comp;

        // Check children
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            comp = obj.getChild(i).getComponent("Component.VFXComponent");
            if (comp) return comp;
        }
        return null;
    }
}
