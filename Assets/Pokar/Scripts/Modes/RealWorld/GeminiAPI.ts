import { GoogleGenAI } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI";
import { GoogleGenAITypes } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes";
import { Lyria } from "RemoteServiceGateway.lspkg/HostedExternal/Lyria";

const GEMINI_MODEL = "gemini-3-flash-preview";

const SYSTEM_MESSAGE =
  //Goal
  "You are an expert in lego and recognizing lego creations inside of augmented reality glasses. Return in the message what lego creations you see." +
  //Return Format
  "Return bounding boxes as a JSON array with labels, your answer should be a JSON object with 4 keys: 'message', 'data', 'sceneDescription', 'musicStyle'. The 'data' key should contain an array of objects, each with a label, coordinates of a bounding box, a soundPrompt, a collisionSoundPrompt, and a color. " +
  "The label should not contain the word 'lego' in it. " +
  "The soundPrompt should be a fun, cartoonish sound that fits the object. NOT realistic - think animated movie or video game sounds. Match the energy of the object: vehicles get engine/motor sounds, space objects get sci-fi sounds, characters get quirky sounds. Examples: car = 'cartoon car engine revving with fun vroom sounds', spaceship = 'sci-fi engine hum with electronic whoosh', robot = 'mechanical whirring with beeps', animal = 'cartoon animal sounds'. Keep it loop-friendly. " +
  "The collisionSoundPrompt should be a short cartoon impact sound - plastic clicking, bouncy bonk, comic book style impacts. Examples: 'plastic brick click clack', 'cartoon bonk impact', 'toy collision pop'. " +
  "The color should be the dominant color of the lego creation as a hex string. Avoid very dark colors - use lighter versions if the object is dark (e.g., '#FF0000' for red, '#00FF00' for green, '#6666FF' for dark blue, '#FF6666' for dark red). " +
  "The 'sceneDescription' should be a short atmospheric description of the overall scene. " +
  "The 'musicStyle' should match the energy of the scene. For vehicles/action: upbeat electronic, driving beats, energetic synths. For space/sci-fi: ambient electronic, synthwave vibes. For characters/animals: fun quirky melodies. For mixed scenes: catchy electronic beat with energy. Examples: vehicles = 'upbeat electronic music with driving beat and synth bass', space = 'ambient synthwave with cosmic vibes', action = 'energetic chiptune with fast tempo'. Avoid lullaby or overly soft music." +
  // Example format:
  "{'message': 'I see lego creations', 'sceneDescription': 'Action scene with vehicles and space craft', 'musicStyle': 'Upbeat electronic music with driving synth bass and energetic beat', 'data': [{'boundingBox': [100, 100, 200, 200], 'label': 'sports car', 'soundPrompt': 'cartoon car engine revving with fun vroom sounds', 'collisionSoundPrompt': 'plastic brick click clack impact', 'color': '#FF0000'}]}" +
  //Warnings
  "Return bounding boxes as a JSON array with labels. Never return masks or code fencing. Limit to 25 objects.\n" +
  "If a lego shape is present multiple times, name them according to their unique characteristic (colors, size, position, unique characteristics, etc..). \n" +
  //Context Dump
  "Dont label anything over 20 feet away from the camera. \n" +
  "Do not label objects that you already labled! Make sure the AR content you add doesnt overlap each other, but feel free to make as many as you see fit! You are the AR and AI BOSS!\n";

const POKER_SYSTEM_MESSAGE =
  "You are an expert Texas Hold'em poker analyst looking through AR glasses at a live poker game. " +
  "The image shows the player's own two hole cards (the cards in their hand) plus the community cards on the table. " +
  "There are 3 community cards on the flop, 4 on the turn, and 5 on the river. " +
  "Carefully identify the player's two hole cards and every visible community card. " +
  "Use standard card notation: rank (A, K, Q, J, T, 9..2) followed by suit (h=hearts, d=diamonds, c=clubs, s=spades). For example 'Ah' is the Ace of hearts, 'Td' is the Ten of diamonds. " +
  "Estimate the player's probability of winning the hand as an integer percentage from 0 to 100, where a higher number means a better hand. " +
  "Assume a typical heads-up to short-handed game (1 to 2 opponents) unless the scene clearly shows more players. Base the estimate on real Texas Hold'em equity given the cards that are still to come. " +
  "Return a JSON object with these keys: " +
  "'winProbability' (integer 0-100), " +
  "'holeCards' (array of the player's two cards in notation, e.g. ['Ah','Kd']), " +
  "'communityCards' (array of the visible table cards in notation), " +
  "'handLabel' (very short name of the player's current best hand or strongest draw, e.g. 'Pair of Kings', 'Flush draw', 'Ace high'), " +
  "'message' (one short, friendly sentence summarizing how strong the hand is). " +
  "If you cannot clearly see the player's two hole cards, set winProbability to -1, leave the card arrays empty, and use 'message' to tell the player to show their cards more clearly. " +
  "Never include code fencing or extra commentary. " +
  "Example: {'winProbability': 72, 'holeCards': ['Ah','Ad'], 'communityCards': ['Kh','7c','2d'], 'handLabel': 'Pair of Aces', 'message': 'Strong made hand, you are well ahead.'}";

const REPLICATE_API_TOKEN = "TODO: Add Replicate API token";
const REPLICATE_VERSION =
  "fcdc421786888a045329d7c4e1874764433a2516b21f4c34bd3da4e054d04cf9";

@component
export class GeminiAPI extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Internet module for making HTTP requests to Replicate API")
  internetModule: InternetModule;
  @input
  @allowUndefined
  @hint("Remote media module for loading audio resources")
  remoteMediaModule: RemoteMediaModule;

  onAwake() {
    // Poker mode uses only the Gemini vision API (no Replicate / Lyria needed).
  }

  makeGeminiRequest(
    texture: Texture,
    userQuery: string,
    callback: (any) => void,
    onAudioReady?: (pointIndex: number, audioAsset: AudioTrackAsset) => void,
  ) {
    Base64.encodeTextureAsync(
      texture,
      (base64String) => {
        this.sendGeminiChat(
          userQuery,
          base64String,
          texture,
          callback,
          onAudioReady,
        );
      },
      () => {},
      CompressionQuality.HighQuality,
      EncodingType.Png,
    );
  }

  /**
   * Capture the current camera frame and ask Gemini to analyze the poker hand.
   * Calls back with { winProbability, holeCards, communityCards, handLabel, message }.
   */
  makePokerRequest(texture: Texture, callback: (response: any) => void) {
    Base64.encodeTextureAsync(
      texture,
      (base64String) => {
        this.sendPokerChat(base64String, callback);
      },
      () => {
        callback({
          winProbability: -1,
          holeCards: [],
          communityCards: [],
          handLabel: "",
          message: "Could not read the camera, try again.",
        });
      },
      CompressionQuality.HighQuality,
      EncodingType.Png,
    );
  }

  private sendPokerChat(image64: string, callback: (response: any) => void) {
    const respSchema: GoogleGenAITypes.Common.Schema = {
      type: "object",
      properties: {
        winProbability: { type: "number" },
        holeCards: { type: "array", items: { type: "string" } },
        communityCards: { type: "array", items: { type: "string" } },
        handLabel: { type: "string" },
        message: { type: "string" },
      },
      required: ["winProbability", "holeCards", "communityCards", "message"],
    };

    const reqObj: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: GEMINI_MODEL,
      type: "generateContent",
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: image64,
                },
              },
              {
                text: "Analyze my poker hand and tell me my chance to win.",
              },
            ],
          },
        ],
        systemInstruction: {
          parts: [{ text: POKER_SYSTEM_MESSAGE }],
        },
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          response_schema: respSchema,
        },
      },
    };

    print("Sending poker analysis request...");

    GoogleGenAI.Gemini.models(reqObj)
      .then((response) => {
        const responseObj = JSON.parse(
          response.candidates[0].content.parts[0].text,
        );
        print("POKER RESPONSE: " + JSON.stringify(responseObj));
        callback({
          winProbability:
            typeof responseObj.winProbability === "number"
              ? Math.round(responseObj.winProbability)
              : -1,
          holeCards: responseObj.holeCards || [],
          communityCards: responseObj.communityCards || [],
          handLabel: responseObj.handLabel || "",
          message: responseObj.message || "",
        });
      })
      .catch((error) => {
        print("Poker analysis error: " + error);
        callback({
          winProbability: -1,
          holeCards: [],
          communityCards: [],
          handLabel: "",
          message: "Analysis failed, pinch to try again.",
        });
      });
  }

  sendGeminiChat(
    request: string,
    image64: string,
    texture: Texture,
    callback: (response: any) => void,
    onAudioReady?: (pointIndex: number, audioAsset: AudioTrackAsset) => void,
  ) {
    var respSchema: GoogleGenAITypes.Common.Schema = {
      type: "object",
      properties: {
        message: { type: "string" },
        sceneDescription: { type: "string" },
        musicStyle: { type: "string" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              boundingBox: {
                type: "array",
                items: { type: "number" },
              },
              label: { type: "string" },
              soundPrompt: { type: "string" },
              collisionSoundPrompt: { type: "string" },
              color: { type: "string" },
            },
            required: [
              "boundingBox",
              "label",
              "soundPrompt",
              "collisionSoundPrompt",
              "color",
            ],
          },
        },
      },
      required: ["message", "data", "sceneDescription", "musicStyle"],
    };

    const reqObj: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: GEMINI_MODEL,
      type: "generateContent",
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: image64,
                },
              },
              {
                text: request,
              },
            ],
          },
        ],
        systemInstruction: {
          parts: [
            {
              text: SYSTEM_MESSAGE,
            },
          ],
        },
        generationConfig: {
          temperature: 0.5,
          responseMimeType: "application/json",
          response_schema: respSchema,
        },
      },
    };

    // Note: Avoid logging reqObj.body as it contains large base64 image data
    print("Sending Gemini request...");

    GoogleGenAI.Gemini.models(reqObj)
      .then((response) => {
        var responseObj = JSON.parse(
          response.candidates[0].content.parts[0].text,
        );
        this.onGeminiResponse(responseObj, texture, callback, onAudioReady);
      })
      .catch((error) => {
        print("Gemini error: " + error);
        if (callback != null) {
          callback({
            points: [],
            aiMessage: "reponse error...",
          });
        }
      });
  }

  private onGeminiResponse(
    responseObj: any,
    texture: Texture,
    callback: (response: any) => void,
    onAudioReady?: (pointIndex: number, audioAsset: AudioTrackAsset) => void,
  ) {
    let geminiResult = {
      points: [],
      aiMessage: "no response",
      sceneDescription: "",
      musicStyle: "",
    };

    print("GEMINI RESPONSE: " + responseObj.message);
    geminiResult.aiMessage = responseObj.message;
    geminiResult.sceneDescription = responseObj.sceneDescription || "";
    geminiResult.musicStyle = responseObj.musicStyle || "";
    print("SCENE DESCRIPTION: " + geminiResult.sceneDescription);
    print("MUSIC STYLE: " + geminiResult.musicStyle);
    try {
      //load points
      var data = responseObj.data;
      print("Data: " + JSON.stringify(data));
      print("POINT LENGTH: " + data.length);
      for (var i = 0; i < data.length; i++) {
        var points = this.boundingBoxToPixels(
          data[i].boundingBox,
          texture.getWidth(),
          texture.getHeight(),
        );
        var lensStudioPoint = {
          pixelPos: points.center,
          topLeft: points.topLeft,
          bottomRight: points.bottomRight,
          label: data[i].label,
          soundPrompt: data[i].soundPrompt || "",
          collisionSoundPrompt: data[i].collisionSoundPrompt || "",
          color: this.ensureBrightColor(data[i].color || "#FFFFFF"),
          audioAsset: null as AudioTrackAsset | null,
          collisionAudioAsset: null as AudioTrackAsset | null,
        };
        geminiResult.points.push(lensStudioPoint);

        // Generate MOVEMENT sound for this creation in parallel
        if (data[i].soundPrompt) {
          // Capture index for closure
          (function (index, pointLabel) {
            this.generateSound(
              pointLabel,
              data[index].soundPrompt,
              (label: string, audioAsset: AudioTrackAsset) => {
                // Store audio asset in the point object
                var point = geminiResult.points.find((p) => p.label === label);
                if (point) {
                  point.audioAsset = audioAsset;
                }
                if (onAudioReady) {
                  onAudioReady(index, audioAsset);
                }
              },
            );
          }).call(this, i, data[i].label);
        }

        // Generate COLLISION sound for this creation in parallel (2 sec duration for short impact)
        if (data[i].collisionSoundPrompt) {
          (function (index, pointLabel, collisionPrompt) {
            this.generateSound(
              pointLabel + "_collision",
              collisionPrompt,
              (label: string, audioAsset: AudioTrackAsset) => {
                // Store collision audio asset in the point object
                var point = geminiResult.points.find(
                  (p) => p.label === pointLabel,
                );
                if (point) {
                  point.collisionAudioAsset = audioAsset;
                  print(
                    `[GeminiAPI] Collision sound ready for "${pointLabel}"`,
                  );
                }
              },
              2, // Short duration for collision/impact sounds
            );
          }).call(this, i, data[i].label, data[i].collisionSoundPrompt);
        }
      }
    } catch (error) {
      print("Error parsing points!: " + error);
    }
    if (callback != null) {
      callback(geminiResult);
    }
  }

  /**
   * Generate sound effect for an object using Replicate API
   * Made public for debug/test purposes
   */
  public async generateSound(
    label: string,
    soundPrompt: string,
    onAudioReady?: (label: string, audioAsset: AudioTrackAsset) => void,
    duration: number = 10,
  ) {
    if (!this.internetModule) {
      return;
    }

    try {
      // Step 1: Create prediction request to Replicate API
      const replicateRequest = new Request(
        "https://api.replicate.com/v1/predictions",
        {
          method: "POST",
          body: JSON.stringify({
            version: REPLICATE_VERSION,
            input: {
              prompt: soundPrompt,
              duration: duration,
              guidance_scale: 4.5,
            },
          }),
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      const replicateResponse =
        await this.internetModule.fetch(replicateRequest);

      // 201 means prediction was created, 200 means it completed immediately
      if (
        replicateResponse.status !== 200 &&
        replicateResponse.status !== 201
      ) {
        return;
      }

      const replicateJson = await replicateResponse.json();
      let responseData = replicateJson.json || replicateJson;

      // Step 2: Poll for completion if status is not "succeeded" yet
      const getUrl =
        responseData.urls?.get ||
        `https://api.replicate.com/v1/predictions/${responseData.id}`;

      let pollCount = 0;
      const maxPolls = 60; // Maximum 60 polls (60 seconds)

      while (
        (responseData.status === "starting" ||
          responseData.status === "processing") &&
        pollCount < maxPolls
      ) {
        // Wait 1 second before polling again
        await new Promise((resolve) => {
          const delayEvent = this.createEvent("DelayedCallbackEvent");
          delayEvent.bind(() => resolve(null));
          delayEvent.reset(1.0);
        });

        // Poll the status
        const statusRequest = new Request(getUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        const statusResponse = await this.internetModule.fetch(statusRequest);
        if (statusResponse.status !== 200) {
          return;
        }

        const statusJson = await statusResponse.json();
        responseData = statusJson.json || statusJson;
        pollCount++;
      }

      if (pollCount >= maxPolls) {
        return;
      }

      // Check if prediction succeeded
      if (responseData.status !== "succeeded" || !responseData.output) {
        return;
      }

      // Step 3: Load audio from the output URL as AudioTrackAsset
      const audioUrl = responseData.output;

      if (!this.remoteMediaModule) {
        return;
      }

      // Create resource from URL
      const resource = (this.internetModule as any).makeResourceFromUrl(
        audioUrl,
      );

      if (!resource) {
        return;
      }

      // Load as audio track asset
      this.remoteMediaModule.loadResourceAsAudioTrackAsset(
        resource,
        (audioAsset: AudioTrackAsset) => {
          if (onAudioReady) {
            onAudioReady(label, audioAsset);
          }
        },
        (error) => {
          // Audio loading failed
        },
      );
    } catch (error) {
      // Sound generation failed
    }
  }

  private boundingBoxToPixels(
    boxPoints: any,
    width: number,
    height: number,
  ): { center: vec2; topLeft: vec2; bottomRight: vec2 } {
    var x1 = MathUtils.remap(boxPoints[1], 0, 1000, 0, width);
    var y1 = MathUtils.remap(boxPoints[0], 0, 1000, height, 0); //flipped for lens studio
    var topLeft = new vec2(x1, height - y1);
    var x2 = MathUtils.remap(boxPoints[3], 0, 1000, 0, width);
    var y2 = MathUtils.remap(boxPoints[2], 0, 1000, height, 0);
    var bottomRight = new vec2(x2, height - y2);
    var center = topLeft.add(bottomRight).uniformScale(0.5);
    return { center, topLeft, bottomRight };
  }

  /**
   * Generate ambient background music using Lyria based on scene description and music style
   */
  generateAmbientSound(
    sceneDescription: string,
    musicStyle: string,
    onAmbientReady?: (audioData: Uint8Array) => void,
  ) {
    if (!musicStyle || musicStyle.trim() === "") {
      return;
    }

    const musicRequest: GoogleGenAITypes.Lyria.LyriaRequest = {
      model: "lyria-002",
      type: "predict",
      body: {
        instances: [
          {
            prompt: musicStyle,
          },
        ],
        parameters: {
          sample_count: 1,
        },
      },
    };

    Lyria.performLyriaRequest(musicRequest)
      .then((response) => {
        if (response && response.error) {
          return;
        }

        if (
          response &&
          response.predictions &&
          response.predictions.length > 0
        ) {
          const b64Audio = response.predictions[0].bytesBase64Encoded;
          if (b64Audio) {
            const decodedAudio = Base64.decode(b64Audio);
            if (onAmbientReady) {
              onAmbientReady(decodedAudio);
            }
          }
        }
      })
      .catch((error) => {
        // Ambient generation failed
      });
  }

  /**
   * Clamp color brightness to minimum 0.4
   * Simply adds offset to dark colors to reach minimum brightness
   */
  private ensureBrightColor(hexColor: string): string {
    const hex = hexColor.replace("#", "");
    if (hex.length !== 6) return hexColor;

    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // Calculate max component (simple brightness check)
    const maxComponent = Math.max(r, g, b);
    const minValue = 102; // 0.4 * 255 = 102

    if (maxComponent < minValue) {
      // Add offset to bring up to minimum
      const offset = minValue - maxComponent;
      r = Math.min(255, r + offset);
      g = Math.min(255, g + offset);
      b = Math.min(255, b + offset);

      const result =
        "#" +
        r.toString(16).padStart(2, "0").toUpperCase() +
        g.toString(16).padStart(2, "0").toUpperCase() +
        b.toString(16).padStart(2, "0").toUpperCase();

      print(`[GeminiAPI] Clamped dark color: ${hexColor} -> ${result}`);
      return result;
    }

    return hexColor;
  }
}
