import {
  BufferImageSource,
  Geometry,
  Mesh,
  Shader,
  Texture,
  type Renderer,
} from "pixi.js";
import { MAX_PALETTE_SIZE, type PaletteEntry } from "../core/constants";

const VERTEX = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vUV;

void main()
{
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uIdTexture;
uniform vec4 uPalette[16];
uniform vec4 uDestroyedColor;

out vec4 finalColor;

void main()
{
    // The texture holds identifiers, not colours: sampling must be nearest,
    // otherwise an interpolated value between id 2 and id 3 would be shown as
    // a colour that does not exist in the palette.
    float normalizedId = texture(uIdTexture, vUV).r;
    int id = int(floor(normalizedId * 255.0 + 0.5));

    if (id == 254)
    {
        // VOID: not part of the playable silhouette.
        discard;
    }

    if (id == 255)
    {
        finalColor = uDestroyedColor;
        return;
    }

    if (id < 0 || id >= 16)
    {
        // Sentinel magenta: an out of range id is a bug, not a colour.
        finalColor = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }

    finalColor = uPalette[id];
}`;

export interface PixelTextureOptions {
  /** Upload frequency cap. Rendering at 60 FPS does not require 60 uploads/s. */
  uploadHz?: number;
}

/**
 * The whole board is one mesh, one R8 texture and one palette lookup.
 *
 * 1024x1024x1 byte = 1 MiB per upload against 4 MiB for an RGBA equivalent,
 * which is the reason the identifier map goes to the GPU raw and the colours
 * are resolved in the shader.
 *
 * The CPU array stays authoritative, so a lost WebGL context is recovered by
 * rebuilding the source from the same `Uint8Array`.
 */
export class PixelTextureRenderer {
  readonly mesh: Mesh<Geometry, Shader>;

  private source: BufferImageSource;
  private texture: Texture;
  private shader: Shader;

  private dirty = true;
  private lastUploadMs = 0;
  private uploadIntervalMs: number;
  private uploads = 0;

  constructor(
    private readonly colorId: Uint8Array,
    private readonly width: number,
    private readonly height: number,
    palette: PaletteEntry[],
    options: PixelTextureOptions = {},
  ) {
    this.uploadIntervalMs = 1000 / (options.uploadHz ?? 30);

    this.source = this.createSource();
    this.texture = new Texture({ source: this.source });
    this.shader = this.createShader(palette);
    this.mesh = new Mesh({ geometry: this.createGeometry(), shader: this.shader });
  }

  private createSource(): BufferImageSource {
    const source = new BufferImageSource({
      resource: this.colorId,
      width: this.width,
      height: this.height,
      format: "r8unorm",
      alphaMode: "no-premultiply-alpha",
    });
    source.scaleMode = "nearest";
    source.autoGenerateMipmaps = false;
    return source;
  }

  private createGeometry(): Geometry {
    return new Geometry({
      attributes: {
        aPosition: new Float32Array([
          0, 0,
          this.width, 0,
          this.width, this.height,
          0, this.height,
        ]),
        aUV: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
  }

  private createShader(palette: PaletteEntry[]): Shader {
    return Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        uIdTexture: this.texture.source,
        uniforms: {
          uPalette: { value: packPalette(palette), type: "vec4<f32>", size: MAX_PALETTE_SIZE },
          uDestroyedColor: { value: new Float32Array([0.05, 0.05, 0.08, 1]), type: "vec4<f32>" },
        },
      },
    });
  }

  setPalette(palette: PaletteEntry[]): void {
    this.shader.resources.uniforms.uniforms.uPalette = packPalette(palette);
  }

  setDestroyedColor(r: number, g: number, b: number, a: number): void {
    this.shader.resources.uniforms.uniforms.uDestroyedColor = new Float32Array([r, g, b, a]);
  }

  setUploadHz(hz: number): void {
    this.uploadIntervalMs = 1000 / Math.max(1, hz);
  }

  markDirty(): void {
    this.dirty = true;
  }

  get uploadCount(): number {
    return this.uploads;
  }

  /** Throttled upload. Returns true when the GPU copy was refreshed. */
  syncTexture(nowMs: number): boolean {
    if (!this.dirty) return false;
    if (nowMs - this.lastUploadMs < this.uploadIntervalMs) return false;

    this.source.update();
    this.dirty = false;
    this.lastUploadMs = nowMs;
    this.uploads++;
    return true;
  }

  /**
   * Rebuilds every GPU resource from the CPU buffer after a context loss.
   * No gameplay state lives on the GPU, so this is always sufficient.
   */
  restore(palette: PaletteEntry[]): void {
    this.source.destroy();
    this.source = this.createSource();
    this.texture = new Texture({ source: this.source });
    this.shader.resources.uIdTexture = this.texture.source;
    this.setPalette(palette);
    this.dirty = true;
    this.lastUploadMs = 0;
  }

  static attachContextLossHandler(renderer: Renderer, onRestore: () => void): () => void {
    const canvas = renderer.canvas as HTMLCanvasElement | undefined;
    if (!canvas?.addEventListener) return () => {};

    const onLost = (event: Event) => event.preventDefault();
    const onRestored = () => onRestore();

    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }

  destroy(): void {
    this.mesh.destroy(true);
    this.source.destroy();
  }
}

export function packPalette(palette: PaletteEntry[]): Float32Array {
  const data = new Float32Array(MAX_PALETTE_SIZE * 4);
  for (let i = 0; i < Math.min(palette.length, MAX_PALETTE_SIZE); i++) {
    const c = palette[i];
    data[i * 4] = c.r / 255;
    data[i * 4 + 1] = c.g / 255;
    data[i * 4 + 2] = c.b / 255;
    data[i * 4 + 3] = (c.a ?? 255) / 255;
  }
  return data;
}
