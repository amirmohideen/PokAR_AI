/**
 * CardDetector_RAW – Card detection with cross-camera depth projection.
 *
 * Mirrors the approach from Snapchat/Spectacles-Sample "Depth Cache":
 *
 *   1. Normalise bbox centre in colour-camera UV space
 *   2. Unproject through the COLOUR camera with a dummy depth to get a ray
 *   3. Re-project that ray onto the DEPTH camera UV space
 *      (handles the FOV / resolution / crop difference between the two cameras)
 *   4. Sample a 3×3 median depth from the depth array at that pixel
 *   5. Unproject depth-camera UV + real depth → device-reference 3D point
 *   6. Multiply by the snapshot pose matrix → world space
 *
 * Depth is snapshot at capture time (same as V2) so colour and depth are
 * time-coherent across the API round-trip.
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

// ─── Depth snapshot ───────────────────────────────────────────────────────────

class DepthSnapshot3 {
  constructor(
    readonly depthFrame: Float32Array,
    readonly depthCamera: DeviceCamera,
    // mat4.fromColumns performs a true deep copy — not just a reference
    readonly poseMatrix: mat4,
  ) {}

  static from(data: DepthFrameData): DepthSnapshot3 {
    const ref = data.toWorldTrackingOriginFromDeviceRef
    return new DepthSnapshot3(
      data.depthFrame.slice(),
      data.deviceCamera,
      mat4.fromColumns(ref.column0, ref.column1, ref.column2, ref.column3),
    )
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

@component
export class CardDetector_RAW extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CardDetector_RAW – Cross-camera depth projection</span><br/><span style="color: #94A3B8; font-size: 11px;">Remaps colour-camera UV → depth-camera UV before sampling, matching Snap Depth Cache sample.</span>')
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
  @hint("Prefab with a Text component — instantiated at each detected card position")
  detectionPrefab: ObjectPrefab

  @input
  @hint("Object pool size — maximum simultaneous detections displayed")
  maxDetections: number = 10
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug</span>')
  @ui.group_start('Debug')
  @input
  @hint("Print full raw JSON from every inference call")
  logRawJson: boolean = true

  @input
  @hint("Only show class label and confidence per detection (overrides logRawJson)")
  logCompact: boolean = false

  @input
  @hint("Only log when detections are found (reduces noise)")
  logOnlyDetections: boolean = false
  @ui.group_end

  private cameraModule:   CameraModule    = require('LensStudio:CameraModule')
  private internetModule: InternetModule  = require('LensStudio:InternetModule')
  private depthModule:    DepthModule     = require('LensStudio:DepthModule')

  private camera:           Texture | null           = null
  private colorDeviceCamera: DeviceCamera | null     = null
  private depthSession:     DepthFrameSession | null = null
  private latestDepthData:  DepthFrameData | null    = null
  private pool:             SceneObject[]            = []
  private running:          boolean                  = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.onStart())
    this.createEvent('OnDestroyEvent').bind(() => {
      this.running = false
      if (this.depthSession) this.depthSession.stop()
    })
  }

  private onStart(): void {
    // Colour camera stream
    const req = CameraModule.createCameraRequest()
    req.cameraId = CameraModule.CameraId.Default_Color
    req.imageSmallerDimension = this.resolution
    this.camera = this.cameraModule.requestCamera(req)

    // Colour camera intrinsics — needed for the cross-projection step
    this.colorDeviceCamera = global.deviceInfoSystem.getTrackingCameraForId(
      CameraModule.CameraId.Left_Color,
    )

    // Depth session — must be created in OnStartEvent, not onAwake
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
    print(`[CardDetector_RAW] Started — ${this.modelPath} @ ${this.resolution}px  pool=${this.pool.length}`)
    this.captureLoop().catch(err => print('[CardDetector_RAW] FATAL: ' + err))
  }

  private async captureLoop(): Promise<void> {
    while (this.running) {
      try {
        const capturedAt = Date.now()
        const snapshot   = await this.nextFrame()

        // Snapshot depth at capture time with full data copies
        const depthAtCapture = this.latestDepthData
          ? DepthSnapshot3.from(this.latestDepthData)
          : null

        const b64     = await this.encodeJpeg(snapshot)
        const rawJson = await this.callApi(b64)
        const result  = DetectionResult.fromJson(rawJson, capturedAt)

        if (!this.logOnlyDetections || result.hasDetections) {
          if (this.logCompact) {
            print(result.toCompactString('CardDetector_RAW'))
          } else if (this.logRawJson) {
            print('[CardDetector_RAW] ' + result.toRawJson(rawJson))
          } else {
            print(result.toLogString('CardDetector_RAW'))
          }
        }

        this.placeDetections(result, depthAtCapture)

      } catch (err) {
        print('[CardDetector_RAW] Error: ' + err)
        await this.delay(1)
      }
    }
  }

  // ── 3D placement ─────────────────────────────────────────────────────────────

  private placeDetections(result: DetectionResult, depth: DepthSnapshot3 | null): void {
    for (let i = 0; i < this.pool.length; i++) {
      const det = result.detections[i]

      if (!det || !depth || !this.colorDeviceCamera) {
        this.pool[i].enabled = false
        continue
      }

      const worldPos = this.toWorldPosition(det.box, result.imageWidth, result.imageHeight, depth)
      if (!worldPos) {
        this.pool[i].enabled = false
        continue
      }

      this.pool[i].getTransform().setWorldPosition(worldPos)
      const text = this.pool[i].getComponent('Component.Text') as Text
      if (text) text.text = `${det.classLabel} ${det.confidencePct}`
      this.pool[i].enabled = true
    }
  }

  private toWorldPosition(
    box: BoundingBox,
    imageWidth: number,
    imageHeight: number,
    depth: DepthSnapshot3,
  ): vec3 | null {
    const colorCam = this.colorDeviceCamera!

    // Step 1: normalise bbox centre to colour-camera UV [0, 1]
    const normalizedColorUV = new vec2(box.centerX / imageWidth, box.centerY / imageHeight)

    // Step 2: unproject through colour camera — dummy depth=100 just produces a ray direction
    const rayInDeviceRef = colorCam.unproject(normalizedColorUV, 100.0)

    // Step 3: re-project onto the depth camera UV space
    //         (depth frame is a cropped + downscaled version of the colour frame)
    const normalizedDepthUV = depth.depthCamera.project(rayInDeviceRef)

    // Reject points outside the depth frame
    if (
      normalizedDepthUV.x < 0 || normalizedDepthUV.x > 1 ||
      normalizedDepthUV.y < 0 || normalizedDepthUV.y > 1
    ) {
      return null
    }

    // Step 4: convert depth UV to pixel coords and sample 3×3 median depth
    const depthRes = depth.depthCamera.resolution
    const depthPixelX = normalizedDepthUV.x * depthRes.x
    const depthPixelY = normalizedDepthUV.y * depthRes.y
    const depthVal = this.getMedianDepth(
      depth.depthFrame, depthRes.x, depthRes.y,
      Math.floor(depthPixelX), Math.floor(depthPixelY),
      1,  // 3×3 window
    )
    if (depthVal === null) return null

    // Step 5: unproject depth-camera UV + real depth → device-reference 3D point
    const pointInDeviceRef = depth.depthCamera.unproject(normalizedDepthUV, depthVal)

    // Step 6: transform to world space using the pose matrix captured at frame time
    return depth.poseMatrix.multiplyPoint(pointInDeviceRef)
  }

  // Samples a (2r+1)² window around (cx, cy), excludes zeros, returns the median.
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
