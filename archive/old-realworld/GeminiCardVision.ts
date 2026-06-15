/**
 * GeminiCardVision – Real-world card recognition via Gemini Vision (RSG).
 *
 * At a fixed interval, captures a camera frame, sends it to Gemini through the
 * Remote Service Gateway with a strict-JSON prompt, and parses the recognised
 * cards into:  { hand_cards: ["Ah","Kd"], field_cards: ["2s","7c","9d"] }
 *
 * CRUCIAL STATE BUFFER: if Gemini returns empty arrays, malformed JSON, or the
 * request fails, the last known-valid hand/field is preserved — it is NEVER
 * overwritten by an empty/failed frame. Only a frame that yields ≥1 valid card
 * updates the buffer. This keeps the readout stable when a hand momentarily
 * occludes the cards or the model misses a frame.
 *
 * SETUP:
 *   1. A RemoteServiceGatewayCredentials component must exist in the scene with a
 *      valid Google token (generate it with the RSG Token Generator plugin).
 *   2. Extended Permissions (camera + internet) must be enabled.
 */

import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini'
import { Card } from '../../Core/CardData'
import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'

export interface RecognizedCards {
  hand: Card[]
  field: Card[]
}

@component
export class GeminiCardVision extends BaseScriptComponent {
  @ui.label('<span style="color:#60A5FA;">GeminiCardVision — real-world card recognition</span>')
  @ui.label('<span style="color:#94A3B8;font-size:11px;">Needs RemoteServiceGatewayCredentials (Google token) + Extended Permissions.</span>')
  @ui.separator

  @input
  @hint('Gemini model id for vision (generateContent).')
  model: string = 'gemini-2.0-flash'

  @input
  @hint('Seconds between capture+inference attempts.')
  intervalSeconds: number = 2.0

  @input
  @hint('Camera stream resolution (max 756 on Spectacles 2024).')
  resolution: number = 640

  @input
  @hint('Log raw Gemini responses.')
  enableLogging: boolean = true

  /** Fires only when a frame yields valid cards; payload is the updated buffer. */
  readonly onCardsUpdated: Event<RecognizedCards> = new Event<RecognizedCards>()

  private cameraModule: any = require('LensStudio:CameraModule')
  private camera: Texture | null = null
  private running = false

  // ── State buffer (last known-valid recognition) ──
  private bufferedHand: Card[] = []
  private bufferedField: Card[] = []

  private readonly prompt =
    'You are a poker card recognizer looking at a real-world poker table through AR glasses. ' +
    'Identify the playing cards you can see. Distinguish the viewer\'s two HOLE cards (closest, ' +
    'in front of the viewer) from the shared FIELD/community cards (in the centre). ' +
    'Respond with ONLY strict minified JSON, no prose, in exactly this shape: ' +
    '{"hand_cards":["Ah","Kd"],"field_cards":["2s","7c","9d"]}. ' +
    'Use rank chars 2-9,T,J,Q,K,A and suit chars s,h,d,c (e.g. Ten of hearts = "Th"). ' +
    'If you cannot clearly identify any card, return empty arrays. Never guess.'

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start())
    this.createEvent('OnDestroyEvent').bind(() => { this.running = false })
  }

  get current(): RecognizedCards {
    return { hand: this.bufferedHand.slice(), field: this.bufferedField.slice() }
  }

  private start(): void {
    const req = CameraModule.createCameraRequest()
    req.cameraId = CameraModule.CameraId.Default_Color
    req.imageSmallerDimension = this.resolution
    this.camera = this.cameraModule.requestCamera(req)

    this.running = true
    if (this.enableLogging) print('[GeminiVision] Started — model=' + this.model)
    this.loop().catch(err => print('[GeminiVision] FATAL: ' + err))
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const tex = await this.nextFrame()
        const b64 = await this.encodeJpeg(tex)
        const raw = await this.callGemini(b64)
        this.ingest(raw)
      } catch (err) {
        // Failure path: DO NOT touch the buffer.
        if (this.enableLogging) print('[GeminiVision] frame error (buffer preserved): ' + err)
      }
      await this.delay(this.intervalSeconds)
    }
  }

  // ── Parse + state-buffer logic ──────────────────────────────────────────────

  private ingest(rawText: string): void {
    const parsed = this.parseResponse(rawText)
    if (!parsed) {
      if (this.enableLogging) print('[GeminiVision] unparseable response — buffer preserved')
      return
    }

    const hand = this.toCards(parsed.hand_cards)
    const field = this.toCards(parsed.field_cards)

    // State buffer rule: only update each list if it contains ≥1 valid card.
    let changed = false
    if (hand.length > 0) {
      this.bufferedHand = hand
      changed = true
    }
    if (field.length > 0) {
      this.bufferedField = field
      changed = true
    }

    if (changed) {
      if (this.enableLogging) {
        print('[GeminiVision] hand=' + this.bufferedHand.map(c => c.code).join(',') +
          ' field=' + this.bufferedField.map(c => c.code).join(','))
      }
      this.onCardsUpdated.invoke(this.current)
    } else if (this.enableLogging) {
      print('[GeminiVision] empty detection — buffer preserved')
    }
  }

  private parseResponse(rawText: string): { hand_cards: string[]; field_cards: string[] } | null {
    if (!rawText) return null
    // Gemini may wrap JSON in markdown fences or extra text — extract the object.
    const start = rawText.indexOf('{')
    const end = rawText.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      const obj = JSON.parse(rawText.slice(start, end + 1))
      return {
        hand_cards: Array.isArray(obj.hand_cards) ? obj.hand_cards : [],
        field_cards: Array.isArray(obj.field_cards) ? obj.field_cards : [],
      }
    } catch (e) {
      return null
    }
  }

  private toCards(codes: string[]): Card[] {
    const out: Card[] = []
    for (const code of codes) {
      const c = Card.parse(String(code))
      if (c) out.push(c)
    }
    return out
  }

  // ── Gemini call ─────────────────────────────────────────────────────────────

  private async callGemini(b64: string): Promise<string> {
    const request: any = {
      model: this.model,
      type: 'generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: this.prompt },
              { inlineData: { mimeType: 'image/jpeg', data: b64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      },
    }
    const response = await Gemini.models(request)
    return response?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }

  // ── Camera helpers (same proven path as the archived detector) ───────────────

  private nextFrame(): Promise<Texture> {
    return new Promise((resolve, reject) => {
      if (!this.camera) { reject(new Error('camera not ready')); return }
      const provider = this.camera.control as CameraTextureProvider
      const reg = provider.onNewFrame.add(() => {
        provider.onNewFrame.remove(reg)
        resolve(ProceduralTextureProvider.createFromTexture(this.camera!))
      })
    })
  }

  private encodeJpeg(texture: Texture): Promise<string> {
    return new Promise((resolve, reject) => {
      Base64.encodeTextureAsync(
        texture,
        resolve,
        () => reject(new Error('JPEG encode failed')),
        CompressionQuality.IntermediateQuality,
        EncodingType.Jpg,
      )
    })
  }

  private delay(seconds: number): Promise<void> {
    return new Promise(resolve => {
      const ev = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent
      ev.bind(() => resolve())
      ev.reset(seconds)
    })
  }
}
