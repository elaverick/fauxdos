import { GREEN_PHOSPHOR_PALETTE } from "./phosphor.js";

const WIDTH = 960;
const HEIGHT = 600;

function makeRasterCanvas(display, graphics) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  let renderedRevision = -1;
  let renderedGraphicsRevision = -1;
  let cursorPhase = true;
  let lastCursorChange = 0;

  function render(now = performance.now(), force = false) {
    if (now - lastCursorChange > 500) {
      cursorPhase = !cursorPhase;
      lastCursorChange = now;
      force = true;
    }
    if (!force && renderedRevision === display.revision && renderedGraphicsRevision === (graphics?.revision ?? -1)) return false;
    const cellW = WIDTH / display.columns;
    const cellH = HEIGHT / display.rows;
    context.fillStyle = "#000500";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    // Character-cell renderer: every glyph is centred in, and constrained
    // to, exactly one terminal cell. Canvas maxWidth applies horizontal-only
    // fitting when a glyph's measured advance would overflow the cell; it
    // never changes the vertical scale. This avoids cumulative advance-width
    // drift and prevents wide glyphs from bleeding into neighbouring cells.
    const fontSize = Math.floor(cellH * 0.88);
    context.font = `${fontSize}px "VT323", monospace`;
    context.textBaseline = "alphabetic";
    context.textAlign = "center";
    context.letterSpacing = "0px";
    context.fontKerning = "none";
    context.shadowColor = "rgba(0, 255, 70, 0.52)";
    context.shadowBlur = Math.min(4, cellH * 0.16);
    context.fillStyle = "#00f75a";
    const baselineOffset = (cellH - fontSize) / 2 + fontSize * 0.82;
    const maxGlyphWidth = Math.max(1, cellW - 1.5);
    for (let y = 0; y < display.rows; y += 1) {
      for (let x = 0; x < display.columns; x += 1) {
        const code = display.cells[y * display.columns + x];
        if (code > 32) {
          const glyph = String.fromCharCode(code);
          const cellCenterX = (x + 0.5) * cellW;
          const baselineY = y * cellH + baselineOffset;
          context.fillText(glyph, cellCenterX, baselineY, maxGlyphWidth);
        }
      }
    }
    if (graphics?.enabled) graphics.render(context, WIDTH, HEIGHT, GREEN_PHOSPHOR_PALETTE);
    if (cursorPhase && !graphics?.enabled) {
      context.fillStyle = "rgba(0, 255, 75, 0.82)";
      context.fillRect(display.cursorX * cellW + 2, display.cursorY * cellH + cellH - 3, cellW - 2, 2);
    }
    // Gentle scan-line texture; the browser UI remains a single output surface.
    context.fillStyle = "rgba(0, 0, 0, 0.10)";
    for (let y = 0; y < HEIGHT; y += 4) context.fillRect(0, y, WIDTH, 1);
    renderedRevision = display.revision;
    renderedGraphicsRevision = graphics?.revision ?? -1;
    return true;
  }
  return { canvas, render };
}

const WGSL = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOut;
  out.position = vec4f(positions[index], 0.0, 1.0);
  out.uv = uvs[index];
  return out;
}
@group(0) @binding(0) var screenSampler: sampler;
@group(0) @binding(1) var screenTexture: texture_2d<f32>;
@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  var color = textureSample(screenTexture, screenSampler, input.uv);
  let vignette = 1.0 - 0.12 * distance(input.uv, vec2f(0.5, 0.5));
  color = vec4f(color.rgb * vignette, 1.0);
  return color;
}
`;

export class TerminalRenderer {
  constructor(canvas, display, graphics, raster) {
    this.canvas = canvas;
    this.display = display;
    this.graphics = graphics;
    this.raster = raster;
    this.backend = "uninitialized";
    this.texture = null;
    this.device = null;
    this.gl = null;
    this.lastUpload = -1;
  }

  static async create(canvas, display, graphics = null) {
    const raster = makeRasterCanvas(display, graphics);
    const renderer = new TerminalRenderer(canvas, display, graphics, raster);
    await renderer.initialize();
    renderer.render(true);
    return renderer;
  }

  async initialize() {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const device = await adapter.requestDevice();
          const context = this.canvas.getContext("webgpu");
          if (context) {
            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: "opaque" });
            const texture = device.createTexture({
              size: [WIDTH, HEIGHT],
              format: "rgba8unorm",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
            const module = device.createShaderModule({ code: WGSL });
            const pipeline = device.createRenderPipeline({
              layout: "auto",
              vertex: { module, entryPoint: "vertexMain" },
              fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
              primitive: { topology: "triangle-list" },
            });
            const bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
              ],
            });
            this.device = device;
            this.context = context;
            this.format = format;
            this.texture = texture;
            this.pipeline = pipeline;
            this.bindGroup = bindGroup;
            this.backend = "webgpu";
            return;
          }
        }
      } catch (error) {
        console.warn("WebGPU unavailable; falling back to WebGL2", error);
      }
    }
    try {
      this.initializeWebGL2();
    } catch (error) {
      console.warn("WebGL2 unavailable; using 2D canvas fallback", error);
      this.initializeCanvas2D();
    }
  }

  initializeCanvas2D() {
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Unable to create a WebGPU, WebGL2, or 2D canvas context");
    this.canvas2d = context;
    this.backend = "canvas2d";
  }

  initializeWebGL2() {
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error("This browser provides neither WebGPU nor WebGL2");
    const vertexSource = `#version 300 es
      precision highp float;
      out vec2 uv;
      void main() {
        vec2 p = vec2((gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5) ? 1.0 : -1.0,
                      (gl_VertexID >= 2 && gl_VertexID != 4) ? 1.0 : -1.0);
        uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
        gl_Position = vec4(p, 0.0, 1.0);
      }`;
    const fragmentSource = `#version 300 es
      precision highp float;
      uniform sampler2D screenImage;
      in vec2 uv;
      out vec4 outColor;
      void main() {
        vec4 c = texture(screenImage, uv);
        float vignette = 1.0 - 0.12 * distance(uv, vec2(0.5));
        outColor = vec4(c.rgb * vignette, 1.0);
      }`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.gl = gl;
    this.program = program;
    this.texture = texture;
    this.backend = "webgl2";
  }

  render(force = false, now = performance.now()) {
    const changed = this.raster.render(now, force);
    if (!changed && !force) return;
    if (this.backend === "webgpu") this.renderWebGPU();
    else if (this.backend === "webgl2") this.renderWebGL2();
    else if (this.backend === "canvas2d") this.canvas2d.drawImage(this.raster.canvas, 0, 0, WIDTH, HEIGHT);
  }

  renderWebGPU() {
    const { device, texture, context, pipeline, bindGroup } = this;
    device.queue.copyExternalImageToTexture({ source: this.raster.canvas }, { texture }, [WIDTH, HEIGHT]);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0.02, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  renderWebGL2() {
    const gl = this.gl;
    gl.viewport(0, 0, WIDTH, HEIGHT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.raster.canvas);
    gl.uniform1i(gl.getUniformLocation(this.program, "screenImage"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Source canvas suitable for uploading into another graphics context. */
  getFrameCanvas() { return this.raster.canvas; }

  /** Return a copy of the terminal's RGBA pixels for a native Vulkan upload path. */
  getPixels() { return this.raster.canvas.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT).data.slice(); }

  /** Upload the current frame into a caller-owned WebGL2 texture. */
  uploadToWebGL(gl, texture) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.raster.canvas);
  }

  /** Copy the current frame into a caller-owned WebGPU texture on the same device. */
  uploadToWebGPU(device, texture) {
    device.queue.copyExternalImageToTexture({ source: this.raster.canvas }, { texture }, [WIDTH, HEIGHT]);
  }
}

export const TERMINAL_TEXTURE_WIDTH = WIDTH;
export const TERMINAL_TEXTURE_HEIGHT = HEIGHT;
