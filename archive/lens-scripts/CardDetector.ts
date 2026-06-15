/**
 * CardDetector – Paired-detection placement with cross-camera depth projection.
 *
 * Each playing card typically produces two detections of the same class (the
 * rank/suit appears in two corners). This version:
 *
 *   1. Groups all detections in a frame by class label
 *   2. Keeps only classes that appear EXACTLY twice
 *   3. Computes the 2D midpoint between the two detections in image space
 *   4. Projects that midpoint to 3D world space using the V3 cross-camera
 *      depth pipeline (colour UV → depth camera UV → median depth → world)
 *   5. Places one Detection prefab per paired card
 *
 * Unpaired detections (single or 3+) are ignored entirely.
 *
 * Requires Extended Permissions (camera + internet together).
 */

// ─── Value types ─────────────────────────────────────────────────────────────

class BoundingBox {
  constructor(
    readonly centerX: number,
    readonly centerY: number,
    readonly width: number,
    readonly height: number,
  ) {}

  get left():   number { return this.centerX - this.width  / 2 }
  get top():    number { return this.centerY - this.height / 2 }
  get right():  number { return this.centerX + this.width  / 2 }
  get bottom(): number { return this.centerY + this.height / 2 }

  toString(): string {
    return `[${Math.round(this.left)},${Math.round(this.top)} ${Math.round(this.width)}×${Math.round(this.height)}]`
  }
}

class CardDetection {
  constructor(
    readonly detectionId: string,
    readonly classLabel: string,
    readonly classId: number,
    readonly confidence: number,
    readonly box: BoundingBox,
  ) {}

  get confidencePct(): string {
    return (this.confidence * 100).toFixed(1) + '%'
  }

  toString(): string {
    return `Card("${this.classLabel}" id=${this.classId} conf=${this.confidencePct} box=${this.box})`
  }

  static fromJson(raw: any): CardDetection {
    return new CardDetection(
      raw.detection_id ?? '',
      raw.class ?? '?',
      raw.class_id ?? -1,
      raw.confidence ?? 0,
      new BoundingBox(raw.x, raw.y, raw.width, raw.height),
    )
  }
}

class DetectionResult {
  constructor(
    readonly inferenceId: string,
    readonly processingMs: number,
    readonly imageWidth: number,
    readonly imageHeight: number,
    readonly detections: CardDetection[],
    readonly capturedAt: number,
  ) {}

  get hasDetections(): boolean { return this.detections.length > 0 }

  toLogString(prefix: string): string {
    const cards = this.detections.map(d => d.toString()).join('\n  ')
    return (
      `[${prefix}] inference=${this.inferenceId.slice(0, 8)} ` +
      `time=${this.processingMs.toFixed(1)}ms ` +
      `img=${this.imageWidth}×${this.imageHeight} ` +
      `detections=${this.detections.length}` +
      (this.hasDetections ? '\n  ' + cards : '')
    )
  }

  toCompactString(prefix: string): string {
    if (!this.hasDetections) return `[${prefix}] No detections`
    const parts = this.detections.map(d => `${d.classLabel} ${d.confidencePct}`)
    return `[${prefix}] ` + parts.join(', ')
  }

  toRawJson(raw: any): string {
    return JSON.stringify(raw, null, 2)
  }

  static fromJson(raw: any, capturedAt: number): DetectionResult {
    const detections = (raw.predictions ?? []).map((p: any) => CardDetection.fromJson(p))
    return new DetectionResult(
      raw.inference_id ?? '',
      (raw.time ?? 0) * 1000,
      raw.image?.width ?? 0,
      raw.image?.height ?? 0,
      detections,
      capturedAt,
    )
  }
}

// ─── Paired card ─────────────────────────────────────────────────────────────

class PairedCard {
  constructor(
    readonly classLabel: string,
    readonly avgConfidencePct: string,
    readonly centerX: number,
    readonly centerY: number,
  ) {}

  toString(): string {
    return `PairedCard("${this.classLabel}" conf=${this.avgConfidencePct} center=(${Math.round(this.centerX)},${Math.round(this.centerY)}))`
  }
}

// ─── Depth snapshot ───────────────────────────────────────────────────────────

class DepthSnapshot4 {
  constructor(
    readonly depthFrame: Float32Array,
    readonly depthCamera: DeviceCamera,
    readonly poseMatrix: mat4,
  ) {}

  static from(data: DepthFrameData): DepthSnapshot4 {
    const ref = data.toWorldTrackingOriginFromDeviceRef
    return new DepthSnapshot4(
      data.depthFrame.slice(),
      data.deviceCamera,
      mat4.fromColumns(ref.column0, ref.column1, ref.column2, ref.column3),
    )
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

@component
export class CardDetector extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CardDetector – Paired-detection placement</span><br/><span style="color: #94A3B8; font-size: 11px;">One prefab per card class detected exactly twice — placed at the 2D midpoint.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Roboflow</span>')
  @ui.group_start('Roboflow')
  @input
  @hint("Your Roboflow API key")
  apiKey: string = "ElXFfdS0MxKgYLAu2sqF"

  @input
  @hint("Model path: {project}/{version}")
  modelPath: string = "playing-cards-muou8/10"

  @input
  @hint("Minimum confidence to include a detection (0–100)")
  confidenceThreshold: number = 40
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Camera</span>')
  @ui.group_start('Camera')
  @input
  @hint("Camera stream resolution in pixels (max 756 on Spectacles 2024)")
  resolution: number = 640
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">3D Placement</span>')
  @ui.group_start('Placement')
  @input
  @hint("Prefab with a Text component — one instance per paired card")
  detectionPrefab: ObjectPrefab

  @input
  @hint("Maximum number of cards to display simultaneously (pool size)")
  maxDetections: number = 10
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug</span>')
  @ui.group_start('Debug')
  @input
  @hint("Print full raw JSON from every inference call")
  logRawJson: boolean = true

  @input
  @hint("Only show paired cards in log (overrides logRawJson)")
  logCompact: boolean = false

  @input
  @hint("Only log when paired cards are found (reduces noise)")
  logOnlyDetections: boolean = false
  @ui.group_end

  private cameraModule:    CameraModule    = require('LensStudio:CameraModule')
  private internetModule:  InternetModule  = require('LensStudio:InternetModule')
  private depthModule:     DepthModule     = require('LensStudio:DepthModule')

  private camera:            Texture | null           = null
  private colorDeviceCamera: DeviceCamera | null      = null
  private depthSession:      DepthFrameSession | null = null
  private latestDepthData:   DepthFrameData | null    = null
  private pool:              SceneObject[]            = []
  private running:           boolean                  = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.onStart())
    this.createEvent('OnDestroyEvent').bind(() => {
      this.running = false
      if (this.depthSession) this.depthSession.stop()
    })
  }

  private onStart(): void {
    const req = CameraModule.createCameraRequest()
    req.cameraId = CameraModule.CameraId.Default_Color
    req.imageSmallerDimension = this.resolution
    this.camera = this.cameraModule.requestCamera(req)

    this.colorDeviceCamera = global.deviceInfoSystem.getTrackingCameraForId(
      CameraModule.CameraId.Left_Color,
    )

    this.depthSession = this.depthModule.createDepthFrameSession()
    this.depthSession.onNewFrame.add((data: DepthFrameData) => {
      this.latestDepthData = data
    })
    this.depthSession.start()

    if (this.detectionPrefab) {
      for (let i = 0; i < this.maxDetections; i++) {
        const obj = this.detectionPrefab.instantiate(this.getSceneObject())
        obj.enabled = false
        this.pool.push(obj)
      }
    }

    this.running = true
    print(`[CardDetector] Started — ${this.modelPath} @ ${this.resolution}px  pool=${this.pool.length}`)
    this.captureLoop().catch(err => print('[CardDetector] FATAL: ' + err))
  }

  private async captureLoop(): Promise<void> {
    while (this.running) {
      try {
        const capturedAt     = Date.now()
        const snapshot       = await this.nextFrame()
        const depthAtCapture = this.latestDepthData
          ? DepthSnapshot4.from(this.latestDepthData)
          : null

        const b64     = await this.encodeJpeg(snapshot)
        const rawJson = await this.callApi(b64)
        const result  = DetectionResult.fromJson(rawJson, capturedAt)
        const pairs   = this.getPairedCards(result.detections)

        if (!this.logOnlyDetections || pairs.length > 0) {
          if (this.logCompact) {
            if (pairs.length === 0) {
              print(`[CardDetector] No paired cards (${result.detections.length} raw detections)`)
            } else {
              print(`[CardDetector] ${pairs.map(p => p.toString()).join(' | ')}`)
            }
          } else if (this.logRawJson) {
            print('[CardDetector] ' + result.toRawJson(rawJson))
          } else {
            print(result.toLogString('CardDetector'))
            if (pairs.length > 0) {
              print(`[CardDetector] Pairs: ${pairs.map(p => p.toString()).join(', ')}`)
            }
          }
        }

        this.placePairedCards(pairs, result.imageWidth, result.imageHeight, depthAtCapture)

      } catch (err) {
        print('[CardDetector] Error: ' + err)
        await this.delay(1)
      }
    }
  }

  // ── Pairing logic ─────────────────────────────────────────────────────────────

  private getPairedCards(detections: CardDetection[]): PairedCard[] {
    // Group by class label
    const groups = new Map<string, CardDetection[]>()
    for (const det of detections) {
      if (!groups.has(det.classLabel)) groups.set(det.classLabel, [])
      groups.get(det.classLabel).push(det)
    }

    // Keep only classes with exactly 2 detections, compute midpoint
    const pairs: PairedCard[] = []
    groups.forEach((dets, label) => {
      if (dets.length !== 2) return
      const centerX      = (dets[0].box.centerX + dets[1].box.centerX) / 2
      const centerY      = (dets[0].box.centerY + dets[1].box.centerY) / 2
      const avgConf      = ((dets[0].confidence + dets[1].confidence) / 2 * 100).toFixed(1) + '%'
      pairs.push(new PairedCard(label, avgConf, centerX, centerY))
    })

    return pairs
  }

  // ── 3D placement ─────────────────────────────────────────────────────────────

  private placePairedCards(
    pairs: PairedCard[],
    imageWidth: number,
    imageHeight: number,
    depth: DepthSnapshot4 | null,
  ): void {
    for (let i = 0; i < this.pool.length; i++) {
      const pair = pairs[i]

      if (!pair || !depth || !this.colorDeviceCamera) {
        this.pool[i].enabled = false
        continue
      }

      const worldPos = this.toWorldPosition(pair.centerX, pair.centerY, imageWidth, imageHeight, depth)
      if (!worldPos) {
        this.pool[i].enabled = false
        continue
      }

      this.pool[i].getTransform().setWorldPosition(worldPos)
      const text = this.pool[i].getComponent('Component.Text') as Text
      if (text) text.text = `${pair.classLabel} ${pair.avgConfidencePct}`
      this.pool[i].enabled = true
    }
  }

  private toWorldPosition(
    pixelX: number,
    pixelY: number,
    imageWidth: number,
    imageHeight: number,
    depth: DepthSnapshot4,
  ): vec3 | null {
    const colorCam = this.colorDeviceCamera!

    // Step 1: normalise midpoint to colour-camera UV [0, 1]
    const normalizedColorUV = new vec2(pixelX / imageWidth, pixelY / imageHeight)

    // Step 2: unproject through colour camera — dummy depth=100 gives ray direction
    const rayInDeviceRef = colorCam.unproject(normalizedColorUV, 100.0)

    // Step 3: re-project onto depth camera UV space
    const normalizedDepthUV = depth.depthCamera.project(rayInDeviceRef)

    if (
      normalizedDepthUV.x < 0 || normalizedDepthUV.x > 1 ||
      normalizedDepthUV.y < 0 || normalizedDepthUV.y > 1
    ) {
      return null
    }

    // Step 4: sample 3×3 median depth at the remapped pixel
    const depthRes  = depth.depthCamera.resolution
    const depthPixelX = normalizedDepthUV.x * depthRes.x
    const depthPixelY = normalizedDepthUV.y * depthRes.y
    const depthVal  = this.getMedianDepth(
      depth.depthFrame, depthRes.x, depthRes.y,
      Math.floor(depthPixelX), Math.floor(depthPixelY),
      1,
    )
    if (depthVal === null) return null

    // Step 5: unproject depth UV + real depth → device-reference 3D point
    const pointInDeviceRef = depth.depthCamera.unproject(normalizedDepthUV, depthVal)

    // Step 6: transform to world space
    return depth.poseMatrix.multiplyPoint(pointInDeviceRef)
  }

  private getMedianDepth(
    data: Float32Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
  ): number | null {
    const xi = Math.round(cx)
    const yi = Math.round(cy)
    const samples: number[] = []

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = xi + dx
        const ny = yi + dy
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const val = data[nx + ny * width]
          if (val > 0) samples.push(val)
        }
      }
    }

    if (samples.length === 0) return null
    samples.sort((a, b) => a - b)
    const mid = Math.floor(samples.length / 2)
    return samples.length % 2 === 0 ? (samples[mid - 1] + samples[mid]) / 2 : samples[mid]
  }

  // ── Capture helpers ──────────────────────────────────────────────────────────

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

  // ── API ──────────────────────────────────────────────────────────────────────

  private async callApi(b64: string): Promise<any> {
    const url = `https://detect.roboflow.com/${this.modelPath}` +
                `?api_key=${this.apiKey}&confidence=${this.confidenceThreshold}`
    const response = await this.internetModule.fetch(
      new Request(url, {
        method: 'POST',
        body: b64,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      }),
    )
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json()
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  private delay(seconds: number): Promise<void> {
    return new Promise(resolve => {
      const ev = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent
      ev.bind(() => resolve())
      ev.reset(seconds)
    })
  }
}
