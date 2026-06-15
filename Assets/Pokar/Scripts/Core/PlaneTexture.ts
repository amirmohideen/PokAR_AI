/**
 * PlaneTexture – Applies a texture to this object's RenderMeshVisual at start.
 *
 * Lens Studio material textures can't be set through the MCP property API, but
 * the script path (mainPass.baseTex) works at runtime. Use this on static
 * textured planes — e.g. the menu's deck-stack card-backs, or the white mode
 * card fronts. Clones the material so each instance can show its own texture.
 */

@component
export class PlaneTexture extends BaseScriptComponent {
  @input
  @hint('Texture to show on this plane.')
  texture: Texture

  @input
  @hint('Clone the material first so this does not affect other planes.')
  cloneMaterial: boolean = true

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.apply())
  }

  apply(): void {
    const visual: any = this.getSceneObject().getComponent('Component.RenderMeshVisual')
    if (!visual || !this.texture) return
    if (this.cloneMaterial && visual.mainMaterial) {
      visual.mainMaterial = visual.mainMaterial.clone()
    }
    if (visual.mainPass) visual.mainPass.baseTex = this.texture
  }
}
