/**
 * CardTextureLibrary – Maps a card code ("Ah", "10d", "Qs") to its face texture.
 *
 * Populate `cardTextures` by dragging the whole Assets/Pokar/Textures/Cards
 * folder onto the input in the editor (Lens Studio adds them all at once). The
 * library indexes them by asset name, so "Ah.png" → key "ah", and aliases the
 * ten between "10x" and "Tx" so it resolves whichever code form is used.
 *
 * One shared instance lives in the scene; CardView looks cards up through it.
 */

@component
export class CardTextureLibrary extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">CardTextureLibrary — code → face texture</span>')
  @ui.label('<span style="color:#94A3B8;font-size:11px;">Drag the Textures/Cards folder into Card Textures.</span>')
  @ui.separator

  @input
  @hint('All 52 card-face textures (+ jokers). Drag the Cards folder here.')
  cardTextures: Texture[] = []

  @input
  @hint('The shared card-back texture (card_back).')
  backTexture: Texture

  private map: { [code: string]: Texture } = {}

  onAwake(): void {
    for (const tex of this.cardTextures) {
      if (!tex) continue
      const key = tex.name.toLowerCase()
      this.map[key] = tex
      // Alias ten: "10h" <-> "th"
      if (key.indexOf('10') === 0) this.map['t' + key.slice(2)] = tex
      else if (key.length === 2 && key[0] === 't') this.map['10' + key.slice(1)] = tex
    }
  }

  /** Face texture for a card code (case-insensitive), or null if missing. */
  getFront(code: string): Texture | null {
    if (!code) return null
    return this.map[code.toLowerCase()] ?? null
  }

  get back(): Texture {
    return this.backTexture
  }
}
