import { requiredValue } from "../runtime/required-value";
// Paper Shaders 0.0.80 (60467401863c1917dd02016d0c1ff2f791d0b3c8), Apache-2.0.
// Meridian modification: synchronous ready paint/errors, runtime failure callback,
// bounded DPR/hardware sizing, reflected uniform validation, upload cleanup,
// owning-context texture-limit getter/guard for hidden deferred image initialization.
// Optional scalar sizing animation on the existing millisecond clock; baseline uniforms stay intact.
// Vertex/fragment GLSL unchanged.
// Full upstream LICENSE/NOTICE and change record: THIRD_PARTY_NOTICES.md.
import { vertexShaderSource } from "./vertex-shader";

const DEFAULT_MAX_PIXEL_COUNT: number = 1920 * 1080 * 4;

export class ShaderMount {
  public parentElement: PaperShaderElement;
  public canvasElement: HTMLCanvasElement;
  private context: WebGL2RenderingContext | undefined;
  private get gl(): WebGL2RenderingContext {
    return requiredValue(this.context);
  }
  private positionBuffer: WebGLBuffer | null = null;
  private initialized = false;
  private validateNextPaint = true;
  private onError: (error: unknown) => void;
  private paintEnabled = true;
  private program: WebGLProgram | null = null;
  private uniformLocations: Record<string, WebGLUniformLocation | null> = {};
  /** The fragment shader that we are using */
  private fragmentShader: string;
  /** Stores the RAF for the render loop */
  private rafId: number | null = null;
  /** Time of the last rendered frame */
  private lastRenderTime = 0;
  /** Total time that we have played any animation, passed as a uniform to the shader for time-based VFX */
  private currentFrame = 0;
  /** The speed that we progress through animation time (multiplies by delta time every update). Allows negatives to play in reverse. If set to 0, rAF will stop entirely so static shaders have no recurring performance costs */
  private speed = 0;
  /** Actual speed used that accounts for visibility: we pause the shader if the tab is hidden or the element out of the viewport */
  private currentSpeed = 0;
  /** Uniforms that are provided by the user for the specific shader being mounted (not including uniforms that this Mount adds, like time and resolution) */
  private providedUniforms: ShaderMountUniforms;
  /** Names of the uniforms that should have mipmaps generated for them */
  private mipmaps: string[] = [];
  /** Just a sanity check to make sure frames don't run after we're disposed */
  private hasBeenDisposed = false;
  /** If the resolution of the canvas has changed since the last render */
  private resolutionChanged = true;
  /** Store textures that are provided by the user */
  private textures: Map<string, WebGLTexture> = new Map();
  private minPixelRatio;
  private maxPixelCount;
  private isSafari = isSafari();
  private uniformCache: Record<string, unknown> = {};
  private textureUnitMap: Map<string, number> = new Map();
  private ownerDocument: Document;
  private maxTextureSize = 0;
  /** Actual owning-context limit, available before deferred image upload. No probe context. */
  public getTextureLimit = (): number => this.maxTextureSize;
  private maxBufferWidth = 0;
  private maxBufferHeight = 0;
  private uniformInfo: Record<string, WebGLActiveInfo> = {};

  constructor(
    /** The div you'd like to mount the shader to. The shader will match its size. */
    parentElement: HTMLElement,
    fragmentShader: string,
    uniforms: ShaderMountUniforms,
    webGlContextAttributes?: WebGLContextAttributes,
    /** The speed of the animation, or 0 to stop it. Supports negative values to play in reverse. */
    speed = 0,
    /** Pass a frame to offset the starting u_time value and give deterministic results*/
    frame = 0,
    /**
     * The minimum pixel ratio to render at, defaults to 2.
     * May be reduced to improve performance or increased together with `maxPixelCount` to improve antialiasing.
     */
    minPixelRatio = 2,
    /**
     * The maximum amount of physical device pixels to render for the shader,
     * by default it's 1920 * 1080 * 2x dpi (per each side) = 8,294,400 pixels of a 4K screen.
     * Actual DOM size of the canvas can be larger, it will just lose quality after this.
     *
     * May be reduced to improve performance or increased to improve quality on high-resolution screens.
     */
    maxPixelCount: number = DEFAULT_MAX_PIXEL_COUNT,
    /** Names of the uniforms that should have mipmaps generated for them */
    mipmaps: string[] = [],
    /** Called for post-construction draw/context errors. Constructor throws on failed first paint. */
    onError: (error: unknown) => void = () => {},
    private maxPixelRatio = 1.5,
    private sizingAnimation?: ShaderSizingAnimation,
    private onPaint: () => void = () => {},
  ) {
    // nodeType check instead of `instanceof` to work across document boundaries (iframes, PiP windows)
    if (parentElement.nodeType === 1) {
      this.parentElement = parentElement;
    } else {
      throw new Error("Paper Shaders: parent element must be an HTMLElement");
    }

    this.onError = onError;
    this.ownerDocument = parentElement.ownerDocument;

    if (!this.ownerDocument.querySelector("style[data-paper-shader]")) {
      const styleElement = this.ownerDocument.createElement("style");
      styleElement.textContent = defaultStyle;
      styleElement.setAttribute("data-paper-shader", "");
      this.ownerDocument.head.prepend(styleElement);
    }

    // Create the canvas element and mount it into the provided element
    const canvasElement = this.ownerDocument.createElement("canvas");
    this.canvasElement = canvasElement;
    this.parentElement.prepend(canvasElement);
    this.fragmentShader = fragmentShader;
    this.providedUniforms = uniforms;
    this.mipmaps = mipmaps;
    // Base our starting animation time on the provided frame value
    this.currentFrame = frame;
    this.minPixelRatio = minPixelRatio;
    this.maxPixelCount = maxPixelCount;

    try {
      const gl = canvasElement.getContext("webgl2", webGlContextAttributes);
      if (!gl) {
        throw new Error(
          "Paper Shaders: WebGL is not supported in this browser",
        );
      }
      this.context = gl;
      canvasElement.addEventListener(
        "webglcontextlost",
        this.handleContextLost,
      );

      this.setupHardwareLimits();
      this.initProgram();
      this.setupPositionAttribute();
      // Grab the locations of the uniforms in the fragment shader
      this.setupUniforms();
      // Put the user provided values into the uniforms
      this.setUniformValues(this.providedUniforms);
      // Set up the resize observer to handle window resizing and set u_resolution
      this.setupResizeObserver();
      // Set up the visual viewport change listener to handle zoom changes (pinch zoom and classic browser zoom)
      visualViewport?.addEventListener(
        "resize",
        this.handleVisualViewportChange,
      );
      // Set up the intersection observer to pause animation when the element is scrolled out of view
      this.setupIntersectionObserver();

      // A successful return is the ready contract: validate a nonzero first draw,
      // without pixel heuristics (transparent and dark configurations are valid).
      const rect = parentElement.getBoundingClientRect();
      this.parentWidth = rect.width;
      this.parentHeight = rect.height;
      if (rect.width <= 0 || rect.height <= 0)
        throw new Error("Paper Shaders: empty mount");
      this.handleResize();
      // Even a 300×150 host (the canvas intrinsic default) needs a first paint.
      this.render(performance.now());
      if (
        this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !==
        this.gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("Paper Shaders: incomplete framebuffer");
      }
      this.assertGlReady();
      this.initialized = true;
      this.setSpeed(speed);

      // Mark parent element as paper shader mount
      this.parentElement.setAttribute("data-paper-shader", "");

      // Add the shaderMount instance to the div mount element to make it easily accessible
      this.parentElement.paperShaderMount = this;

      // Listen for document visibility changes to pause the shader when the tab is hidden
      this.ownerDocument.addEventListener(
        "visibilitychange",
        this.handleDocumentVisibilityChange,
      );
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private setupHardwareLimits = () => {
    const gl = this.gl;
    const texture: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const renderbuffer: unknown = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const rawViewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const viewport =
      rawViewport instanceof Int32Array || Array.isArray(rawViewport)
        ? (rawViewport as ArrayLike<unknown>)
        : undefined;
    const valid = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 1;
    // Missing limits are not permission to allocate an unbounded canvas.
    if (
      !valid(texture) ||
      !valid(renderbuffer) ||
      !valid(viewport?.[0]) ||
      !valid(viewport[1])
    ) {
      throw new Error("Paper Shaders: invalid WebGL drawing buffer limits");
    }
    this.maxTextureSize = Math.floor(texture);
    this.maxBufferWidth = Math.floor(
      Math.min(texture, renderbuffer, viewport[0]),
    );
    this.maxBufferHeight = Math.floor(
      Math.min(texture, renderbuffer, viewport[1]),
    );
  };

  private assertGlReady = () => {
    const error = this.gl.getError();
    if (this.gl.isContextLost() || error !== this.gl.NO_ERROR) {
      throw new Error(`Paper Shaders: draw/upload error ${String(error)}`);
    }
  };

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.fail(new Error("Paper Shaders: WebGL context lost"));
  };

  private fail = (error: unknown) => {
    if (this.hasBeenDisposed) return;
    const callback = this.onError;
    this.dispose();
    callback(error);
  };

  private initProgram = () => {
    const program = createProgram(
      this.gl,
      vertexShaderSource,
      this.fragmentShader,
    );
    if (program === null)
      throw new Error("Paper Shaders: shader compilation/link failed");
    this.program = program;
    const count: unknown = this.gl.getProgramParameter(
      program,
      this.gl.ACTIVE_UNIFORMS,
    );
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
      throw new Error("Paper Shaders: invalid uniform count");
    for (let index = 0; index < count; index++) {
      const info = this.gl.getActiveUniform(program, index);
      if (info) this.uniformInfo[info.name.replace(/\[0\]$/, "")] = info;
    }
  };

  private setupPositionAttribute = () => {
    const positionAttributeLocation = this.gl.getAttribLocation(
      requiredValue(this.program),
      "a_position",
    );
    const positionBuffer = this.gl.createBuffer() as WebGLBuffer | null;
    if (positionBuffer === null)
      throw new Error("Paper Shaders: buffer allocation failed");
    this.positionBuffer = positionBuffer;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array(positions),
      this.gl.STATIC_DRAW,
    );
    this.gl.enableVertexAttribArray(positionAttributeLocation);
    this.gl.vertexAttribPointer(
      positionAttributeLocation,
      2,
      this.gl.FLOAT,
      false,
      0,
      0,
    );
  };

  private setupUniforms = () => {
    // Create a map to store all uniform locations
    const uniformLocations: Record<string, WebGLUniformLocation | null> = {
      u_time: this.gl.getUniformLocation(requiredValue(this.program), "u_time"),
      u_pixelRatio: this.gl.getUniformLocation(
        requiredValue(this.program),
        "u_pixelRatio",
      ),
      u_resolution: this.gl.getUniformLocation(
        requiredValue(this.program),
        "u_resolution",
      ),
    };

    // Add locations for all provided uniforms
    Object.entries(this.providedUniforms).forEach(([key, value]) => {
      uniformLocations[key] = this.gl.getUniformLocation(
        requiredValue(this.program),
        key,
      );

      // For texture uniforms, also look for the aspect ratio uniform
      if (value instanceof HTMLImageElement) {
        const aspectRatioUniformName = `${key}AspectRatio`;
        uniformLocations[aspectRatioUniformName] = this.gl.getUniformLocation(
          requiredValue(this.program),
          aspectRatioUniformName,
        );
      }
    });

    this.uniformLocations = uniformLocations;
  };

  /**
   * The scale that we should render at.
   * - Used to target 2x rendering even on 1x screens for better antialiasing
   * - Prevents the virtual resolution from going beyond the maximum resolution
   * - Accounts for the page zoom level so we render in physical device pixels rather than CSS pixels
   */
  private renderScale = 1;
  private parentWidth = 0;
  private parentHeight = 0;
  private parentDevicePixelWidth = 0;
  private parentDevicePixelHeight = 0;
  private devicePixelsSupported = false;

  private intersectionObserver: IntersectionObserver | null = null;
  private isInViewport = true;

  private resizeObserver: ResizeObserver | null = null;
  private setupResizeObserver = () => {
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (entry?.borderBoxSize[0]) {
        const physicalPixelSize = entry.devicePixelContentBoxSize[0];

        if (physicalPixelSize !== undefined) {
          this.devicePixelsSupported = true;
          this.parentDevicePixelWidth = physicalPixelSize.inlineSize;
          this.parentDevicePixelHeight = physicalPixelSize.blockSize;
        }

        this.parentWidth = entry.borderBoxSize[0].inlineSize;
        this.parentHeight = entry.borderBoxSize[0].blockSize;
      }

      this.handleResize();
    });

    this.resizeObserver.observe(this.parentElement);
  };

  private setupIntersectionObserver = () => {
    // we check element's own window to support shaders used within iframe/PiP elements
    const view = this.ownerDocument.defaultView;
    if (!view?.IntersectionObserver) return;

    this.intersectionObserver = new view.IntersectionObserver(([entry]) => {
      this.isInViewport = entry?.isIntersecting ?? true;
      this.updateCurrentSpeed();
    });

    this.intersectionObserver.observe(this.parentElement);
  };

  // Visual viewport resize handler, mainly used to react to browser zoom changes.
  // Resize observer by itself does not react to pinch zoom, and although it usually
  // reacts to classic browser zoom, it's not guaranteed in edge cases.
  // Since timing between visual viewport changes and resize observer is complex
  // and because we'd like to know the device pixel sizes of elements, we just restart
  // the observer to get a guaranteed fresh callback regardless if it would have triggered or not.
  private handleVisualViewportChange = () => {
    this.resizeObserver?.disconnect();
    this.setupResizeObserver();

    // In case of debugging timing, from here on:
    // - animation frame 1: a paint after the visual viewport resize
    // - animation frame 2: a paint after the resize observer has been handled, if it was ever triggered
  };

  /** Resize handler for when the container div changes size or the max pixel count changes and we want to resize our canvas to match */
  private handleResize = () => {
    if (this.hasBeenDisposed || this.parentWidth <= 0 || this.parentHeight <= 0)
      return;
    // Aim to render at least as many pixels as physically displayed
    // This will overshoot when the user zooms out, but that's acceptable

    let targetPixelWidth: number;
    let targetPixelHeight: number;

    // If window.devicePixelRatio is below 1, it's safe to say the browser is just zoomed out
    // We can use 1 as the minimum value not to upscale it needlessly to meet the min pixel ratio param
    const dpr = Math.max(1, window.devicePixelRatio);
    const pinchZoom = visualViewport?.scale ?? 1;

    if (this.devicePixelsSupported) {
      // Use the real pixel size if we know it, plus meet the min pixel ratio requirement and add in pinch zoom
      const scaleToMeetMinPixelRatio = Math.max(1, this.minPixelRatio / dpr);
      targetPixelWidth =
        this.parentDevicePixelWidth * scaleToMeetMinPixelRatio * pinchZoom;
      targetPixelHeight =
        this.parentDevicePixelHeight * scaleToMeetMinPixelRatio * pinchZoom;
    } else {
      // Otherwise try to approximate the element size in device pixels using devicePixelRatio.
      // (devicePixelRatio is imprecise and element's width/height may be fractional CSS sizes, not real pixels).
      let targetRenderScale = Math.max(dpr, this.minPixelRatio) * pinchZoom;

      if (this.isSafari) {
        // As of 2025, Safari reports physical devicePixelRatio, but other browsers add the current zoom level:
        // https://bugs.webkit.org/show_bug.cgi?id=124862
        //
        // In Safari we need to factor in the zoom level manually in order to set the target resolution.
        // To avoid sidebars upscaling the target resolution, set a minimum zoom level of 1.
        // This will render at higher resolution when zoomed out, but that's fine.
        // (We mostly care about maintaining good quality when zoomed in).
        const zoomLevel = bestGuessBrowserZoom(this.ownerDocument);
        targetRenderScale *= Math.max(1, zoomLevel);
      }

      // Rounding the client width/height since they may be fractional in CSS layout values
      targetPixelWidth = Math.round(this.parentWidth) * targetRenderScale;
      targetPixelHeight = Math.round(this.parentHeight) * targetRenderScale;
    }

    // Meridian cap is a maximum, unlike upstream minPixelRatio. Preserve sizing math.
    const ratioCap = Math.min(
      1,
      (this.parentWidth * this.maxPixelRatio) / targetPixelWidth,
      (this.parentHeight * this.maxPixelRatio) / targetPixelHeight,
    );
    targetPixelWidth *= ratioCap;
    targetPixelHeight *= ratioCap;

    try {
      // One uniform scale preserves aspect, including skinny hosts below the area cap.
      const scale = Math.min(
        1,
        Math.sqrt(this.maxPixelCount / (targetPixelWidth * targetPixelHeight)),
        this.maxBufferWidth / targetPixelWidth,
        this.maxBufferHeight / targetPixelHeight,
      );
      const newWidth = Math.max(1, Math.round(targetPixelWidth * scale));
      const newHeight = Math.max(1, Math.round(targetPixelHeight * scale));
      if (!Number.isFinite(newWidth) || !Number.isFinite(newHeight)) {
        throw new Error("Paper Shaders: invalid drawing buffer dimensions");
      }
      const resized =
        this.canvasElement.width !== newWidth ||
        this.canvasElement.height !== newHeight;
      if (resized) {
        this.canvasElement.width = newWidth;
        this.canvasElement.height = newHeight;
      }
      // Implementations can allocate less than the requested canvas attributes.
      // Upstream u_resolution is in buffer pixels; u_pixelRatio converts CSS units.
      const width = this.gl.drawingBufferWidth;
      const height = this.gl.drawingBufferHeight;
      if (
        this.gl.isContextLost() ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        throw new Error("Paper Shaders: empty or lost drawing buffer");
      }
      const newRenderScale = width / this.parentWidth;
      if (
        resized ||
        this.renderScale !== newRenderScale ||
        this.resolutionChanged
      ) {
        this.renderScale = newRenderScale;
        this.resolutionChanged = true;
        this.validateNextPaint = true;
        this.gl.viewport(0, 0, width, height);
        this.render(performance.now());
      }
    } catch (error) {
      if (!this.initialized) throw error;
      this.fail(error);
    }
  };

  private render = (currentTime: number) => {
    if (this.hasBeenDisposed || !this.paintEnabled) return;
    try {
      if (this.program === null) {
        console.warn("Tried to render before program or gl was initialized");
        return;
      }

      // Calculate the delta time
      const dt = currentTime - this.lastRenderTime;
      this.lastRenderTime = currentTime;
      // Increase the total animation time by dt * animationSpeed
      if (this.currentSpeed !== 0) {
        this.currentFrame += dt * this.currentSpeed;
      }

      // Clear the canvas
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);

      // Update uniforms
      this.gl.useProgram(this.program);

      // Update the time uniform
      this.gl.uniform1f(
        requiredValue(this.uniformLocations.u_time),
        this.currentFrame * 0.001,
      );

      // If the resolution has changed, we need to update the uniform
      if (this.resolutionChanged) {
        this.gl.uniform2f(
          requiredValue(this.uniformLocations.u_resolution),
          this.gl.drawingBufferWidth,
          this.gl.drawingBufferHeight,
        );
        this.gl.uniform1f(
          requiredValue(this.uniformLocations.u_pixelRatio),
          this.renderScale,
        );
        this.resolutionChanged = false;
      }

      // Derive from caller-owned baseline values, never from the previous animated upload.
      // This is part of the existing paint: no extra RAF, draw, or GL validation query.
      if (this.sizingAnimation) {
        this.setUniformValues(
          this.sizingAnimation(
            this.currentFrame,
            this.providedUniforms,
            this.gl.drawingBufferWidth,
            this.gl.drawingBufferHeight,
          ),
        );
      }

      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
      // Validate invalidated paints, not every animation tick (getError can synchronize).
      // Context loss has its own event; draw exceptions are caught on every frame.
      if (this.validateNextPaint) {
        this.assertGlReady();
        this.validateNextPaint = false;
      }
      this.onPaint();

      // Loop if we're animating
      if (this.currentSpeed !== 0) {
        this.requestRender();
      } else {
        this.rafId = null;
      }
    } catch (error) {
      if (!this.initialized) throw error;
      this.fail(error);
    }
  };

  private requestRender = () => {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(this.render);
  };

  /** Creates a texture from an image and sets it into a uniform value */
  private setTextureUniform = (
    uniformName: string,
    image: HTMLImageElement,
  ): void => {
    if (
      !image.complete ||
      image.naturalWidth <= 0 ||
      image.naturalHeight <= 0
    ) {
      throw new Error(
        `Paper Shaders: image for uniform ${uniformName} must be fully loaded`,
      );
    }

    if (
      image.naturalWidth > this.maxTextureSize ||
      image.naturalHeight > this.maxTextureSize
    ) {
      throw new Error(
        `Paper Shaders: texture exceeds owning context limit for ${uniformName}`,
      );
    }
    const existingTexture = this.textures.get(uniformName);

    // Get texture unit
    if (!this.textureUnitMap.has(uniformName)) {
      this.textureUnitMap.set(uniformName, this.textureUnitMap.size);
    }
    const textureUnit = requiredValue(this.textureUnitMap.get(uniformName));
    // Activate correct texture unit before creating the texture
    this.gl.activeTexture(this.gl.TEXTURE0 + textureUnit);

    // Create and set up the new texture
    const texture = this.gl.createTexture() as WebGLTexture | null;
    if (texture === null)
      throw new Error(
        `Paper Shaders: texture allocation failed for ${uniformName}`,
      );
    try {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

      // Set texture parameters
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_WRAP_S,
        this.gl.CLAMP_TO_EDGE,
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_WRAP_T,
        this.gl.CLAMP_TO_EDGE,
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_MIN_FILTER,
        this.gl.LINEAR,
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_2D,
        this.gl.TEXTURE_MAG_FILTER,
        this.gl.LINEAR,
      );

      // Upload image to texture
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        image,
      );

      // Generate mipmaps if the uniform is in the mipmaps list
      if (this.mipmaps.includes(uniformName)) {
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        this.gl.texParameteri(
          this.gl.TEXTURE_2D,
          this.gl.TEXTURE_MIN_FILTER,
          this.gl.LINEAR_MIPMAP_LINEAR,
        );
      }

      const error = this.gl.getError();
      if (this.gl.isContextLost() || error !== this.gl.NO_ERROR) {
        throw new Error(
          `Paper Shaders: texture upload failed for ${uniformName}: ${String(error)}`,
        );
      }
    } catch (error) {
      // texImage2D can throw (e.g. SecurityError) before any GL error is set.
      this.gl.deleteTexture(texture);
      throw error;
    }

    // Replace only after a successful upload; failure cleanup still owns the old texture.
    this.textures.set(uniformName, texture);
    if (existingTexture) this.gl.deleteTexture(existingTexture);

    // Set up texture unit and uniform
    const location = this.uniformLocations[uniformName];
    if (location) {
      this.gl.uniform1i(location, textureUnit);

      // Calculate and set the aspect ratio uniform
      const aspectRatioUniformName = `${uniformName}AspectRatio`;
      const aspectRatioLocation = this.uniformLocations[aspectRatioUniformName];
      if (aspectRatioLocation) {
        const aspectRatio = image.naturalWidth / image.naturalHeight;
        this.gl.uniform1f(aspectRatioLocation, aspectRatio);
      }
    }
  };

  /** Utility: recursive equality test for all the uniforms */
  private areUniformValuesEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      return (a as unknown[]).every((val, i) =>
        this.areUniformValuesEqual(val, (b as unknown[])[i]),
      );
    }
    return false;
  };

  /** Sets the provided uniform values into the WebGL program, can be a partial list of uniforms that have changed */
  private setUniformValues = (updatedUniforms: ShaderMountUniforms) => {
    this.gl.useProgram(this.program);
    Object.entries(updatedUniforms).forEach(([key, value]) => {
      // Undefined and inactive uniforms are intentionally permitted.
      if (value === undefined) return;
      // Grab the value to use in the uniform cache
      let cacheValue: ShaderMountUniforms[keyof ShaderMountUniforms] | string =
        value;
      if (value instanceof HTMLImageElement) {
        // Images use their src for the cache value to save memory
        cacheValue = `${value.src}|${String(value.naturalWidth)}x${String(value.naturalHeight)}`;
      }

      // Check if the uniform value has changed and, if not, bail early to avoid extra work
      if (this.areUniformValuesEqual(this.uniformCache[key], cacheValue))
        return;
      // Snapshot arrays so caller mutation cannot bypass validation or uploads.
      this.uniformCache[key] = Array.isArray(cacheValue)
        ? cacheValue.map((item) => (Array.isArray(item) ? [...item] : item))
        : cacheValue;

      const location = this.uniformLocations[key];
      if (!location) return; // Optimized-out official uniforms are intentionally inactive.

      if (value instanceof HTMLImageElement) {
        // Texture case, requires a good amount of code so it gets its own function:
        this.setTextureUniform(key, value);
      } else if (Array.isArray(value)) {
        this.setArrayUniform(key, location, value);
      } else if (typeof value === "number") {
        // Number case, supports floats and ints
        this.gl.uniform1f(location, value);
      } else if (typeof value === "boolean") {
        // Boolean case, supports true and false
        this.gl.uniform1i(location, value ? 1 : 0);
      } else {
        // May happen on the server for SSR when undefined images are passed in
        console.warn(`Unsupported uniform type for ${key}: ${typeof value}`);
      }
    });
  };

  /** Validate against the linked shader, not a guessed array length (mat2 and vec4 differ). */
  private setArrayUniform = (
    key: string,
    location: WebGLUniformLocation,
    value: number[] | number[][],
  ) => {
    const gl = this.gl;
    const info = this.uniformInfo[key.replace(/\[0\]$/, "")];
    const shapes: Record<number, [number, (data: number[]) => void]> = {
      [gl.FLOAT]: [
        1,
        (data) => {
          gl.uniform1fv(location, data);
        },
      ],
      [gl.FLOAT_VEC2]: [
        2,
        (data) => {
          gl.uniform2fv(location, data);
        },
      ],
      [gl.FLOAT_VEC3]: [
        3,
        (data) => {
          gl.uniform3fv(location, data);
        },
      ],
      [gl.FLOAT_VEC4]: [
        4,
        (data) => {
          gl.uniform4fv(location, data);
        },
      ],
      [gl.INT]: [
        1,
        (data) => {
          gl.uniform1iv(location, data);
        },
      ],
      [gl.INT_VEC2]: [
        2,
        (data) => {
          gl.uniform2iv(location, data);
        },
      ],
      [gl.INT_VEC3]: [
        3,
        (data) => {
          gl.uniform3iv(location, data);
        },
      ],
      [gl.INT_VEC4]: [
        4,
        (data) => {
          gl.uniform4iv(location, data);
        },
      ],
      [gl.BOOL]: [
        1,
        (data) => {
          gl.uniform1iv(location, data);
        },
      ],
      [gl.BOOL_VEC2]: [
        2,
        (data) => {
          gl.uniform2iv(location, data);
        },
      ],
      [gl.BOOL_VEC3]: [
        3,
        (data) => {
          gl.uniform3iv(location, data);
        },
      ],
      [gl.BOOL_VEC4]: [
        4,
        (data) => {
          gl.uniform4iv(location, data);
        },
      ],
      [gl.UNSIGNED_INT]: [
        1,
        (data) => {
          gl.uniform1uiv(location, data);
        },
      ],
      [gl.UNSIGNED_INT_VEC2]: [
        2,
        (data) => {
          gl.uniform2uiv(location, data);
        },
      ],
      [gl.UNSIGNED_INT_VEC3]: [
        3,
        (data) => {
          gl.uniform3uiv(location, data);
        },
      ],
      [gl.UNSIGNED_INT_VEC4]: [
        4,
        (data) => {
          gl.uniform4uiv(location, data);
        },
      ],
      [gl.FLOAT_MAT2]: [
        4,
        (data) => {
          gl.uniformMatrix2fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT3]: [
        9,
        (data) => {
          gl.uniformMatrix3fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT4]: [
        16,
        (data) => {
          gl.uniformMatrix4fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT2x3]: [
        6,
        (data) => {
          gl.uniformMatrix2x3fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT2x4]: [
        8,
        (data) => {
          gl.uniformMatrix2x4fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT3x2]: [
        6,
        (data) => {
          gl.uniformMatrix3x2fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT3x4]: [
        12,
        (data) => {
          gl.uniformMatrix3x4fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT4x2]: [
        8,
        (data) => {
          gl.uniformMatrix4x2fv(location, false, data);
        },
      ],
      [gl.FLOAT_MAT4x3]: [
        12,
        (data) => {
          gl.uniformMatrix4x3fv(location, false, data);
        },
      ],
    };
    const shape = info && shapes[info.type];
    if (!shape)
      throw new Error(`Paper Shaders: unsupported active uniform array ${key}`);
    const [components, upload] = shape;
    const nested = value.some(Array.isArray);
    const flat = value.flat();
    if (
      !flat.length ||
      flat.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
      (nested &&
        !value.every(
          (row) => Array.isArray(row) && row.length === components,
        )) ||
      flat.length % components !== 0 ||
      flat.length > components * info.size ||
      (!info.name.endsWith("[0]") && flat.length !== components)
    ) {
      throw new Error(
        `Paper Shaders: invalid uniform array ${key}; expected ${String(components)} components per element, 1..${String(info.size)} elements`,
      );
    }
    upload(flat);
  };

  /** Gets the current total animation time from 0ms */
  public getCurrentFrame = (): number => {
    return this.currentFrame;
  };

  /** Set a frame to get a deterministic result, frames are literally just milliseconds from zero since the animation started */
  public setFrame = (newFrame: number): void => {
    if (this.hasBeenDisposed) return;
    this.currentFrame = newFrame;
    const now = performance.now();
    this.lastRenderTime = now;
    this.render(now);
  };

  /** Set an animation speed (or 0 to stop animation) */
  /** Suppress one-off paints and RAF until this browser page becomes active again. */
  public setPaintEnabled = (enabled: boolean): void => {
    if (this.hasBeenDisposed || this.paintEnabled === enabled) return;
    this.paintEnabled = enabled;
    this.updateCurrentSpeed();
    if (enabled) this.render(performance.now());
  };

  public setSpeed = (newSpeed = 1): void => {
    // Set the new animation speed
    this.speed = newSpeed;
    this.updateCurrentSpeed();
  };

  /** Apply the target speed, pausing (0) while the tab is hidden or the element is out of the viewport */
  private updateCurrentSpeed = (): void => {
    this.setCurrentSpeed(
      !this.paintEnabled || this.ownerDocument.hidden || !this.isInViewport
        ? 0
        : this.speed,
    );
  };

  private setCurrentSpeed = (newSpeed: number): void => {
    if (this.hasBeenDisposed) return;
    this.currentSpeed = newSpeed;

    if (this.rafId === null && newSpeed !== 0) {
      // Moving from 0 to animating, kick off a new rAF loop
      this.lastRenderTime = performance.now();
      this.rafId = requestAnimationFrame(this.render);
    }

    if (this.rafId !== null && newSpeed === 0) {
      // Moving from animating to not animating, cancel the rAF loop
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  };

  /** Set the maximum pixel count for the shader, this will limit the number of pixels that will be rendered */
  public setMaxPixelCount = (
    newMaxPixelCount: number = DEFAULT_MAX_PIXEL_COUNT,
  ): void => {
    this.maxPixelCount = newMaxPixelCount;

    this.handleResize();
  };

  /** Set the minimum pixel ratio for the shader */
  public setMinPixelRatio = (newMinPixelRatio: number = 2): void => {
    this.minPixelRatio = newMinPixelRatio;

    this.handleResize();
  };

  /** Update the uniforms that are provided by the outside shader, can be a partial set with only the uniforms that have changed */
  public setUniforms = (newUniforms: ShaderMountUniforms): void => {
    if (this.hasBeenDisposed) return;
    try {
      // Discover newly introduced image/aspect-ratio uniforms for later image adapters.
      this.providedUniforms = { ...this.providedUniforms, ...newUniforms };
      if (
        Object.entries(newUniforms).some(
          ([key, value]) =>
            !(key in this.uniformLocations) ||
            (value instanceof HTMLImageElement &&
              !(`${key}AspectRatio` in this.uniformLocations)),
        )
      )
        this.setupUniforms();
      this.setUniformValues(newUniforms);
      this.validateNextPaint = true;

      this.render(performance.now());
    } catch (error) {
      this.fail(error);
    }
  };

  private handleDocumentVisibilityChange = () => {
    this.updateCurrentSpeed();
  };

  /** Dispose of the shader mount, cleaning up all of the WebGL resources */
  public dispose = (): void => {
    if (this.hasBeenDisposed) return;
    // Immediately mark as disposed to prevent future renders from leaking in
    this.hasBeenDisposed = true;

    // Cancel the rAF loop
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.context) {
      // Clean up all textures
      this.textures.forEach((texture) => {
        this.gl.deleteTexture(texture);
      });
      this.textures.clear();

      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      this.positionBuffer = null;
      this.gl.deleteProgram(this.program);
      this.program = null;

      // Reset the WebGL context
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
      this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, null);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

      // Clear any errors
      this.gl.getError();
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    visualViewport?.removeEventListener(
      "resize",
      this.handleVisualViewportChange,
    );
    this.ownerDocument.removeEventListener(
      "visibilitychange",
      this.handleDocumentVisibilityChange,
    );

    this.uniformLocations = {};
    this.uniformInfo = {};
    this.uniformCache = {};
    this.providedUniforms = {};
    this.textureUnitMap.clear();
    this.fragmentShader = "";
    this.sizingAnimation = undefined;
    this.mipmaps = [];
    this.speed = this.currentSpeed = 0;
    this.onError = () => {};
    this.canvasElement.removeEventListener(
      "webglcontextlost",
      this.handleContextLost,
    );
    this.context?.getExtension("WEBGL_lose_context")?.loseContext();

    // Remove the shader from the div wrapper element
    this.canvasElement.remove();
    // Free up the reference to self to enable garbage collection
    delete this.parentElement.paperShaderMount;
  };
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  const compiled: unknown = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compiled) {
    console.error(
      "An error occurred compiling the shaders: " +
        String(gl.getShaderInfoLog(shader)),
    );
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexShaderSource: string,
  fragmentShaderSource: string,
): WebGLProgram | null {
  const format = gl.getShaderPrecisionFormat(
    gl.FRAGMENT_SHADER,
    gl.MEDIUM_FLOAT,
  );
  const precision = format ? format.precision : null;
  // MEDIUM_FLOAT precision can be 10, 16 or 23 bits depending on device;
  // Shaders fail on 10 bit (and 16 bit is hard to test) => we force 23-bit by switching to highp
  if (precision && precision < 23) {
    vertexShaderSource = vertexShaderSource.replace(
      /precision\s+(lowp|mediump)\s+float;/g,
      "precision highp float;",
    );
    fragmentShaderSource = fragmentShaderSource
      .replace(/precision\s+(lowp|mediump)\s+float/g, "precision highp float")
      .replace(
        /\b(uniform|varying|attribute)\s+(lowp|mediump)\s+(\w+)/g,
        "$1 highp $3",
      );
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );

  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram() as WebGLProgram | null;
  if (program === null) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const linked: unknown = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linked) {
    console.error(
      "Unable to initialize the shader program: " +
        String(gl.getProgramInfoLog(program)),
    );
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  // Clean up shaders after successful linking
  gl.detachShader(program, vertexShader);
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

const defaultStyle = `@layer paper-shaders {
  :where([data-paper-shader]) {
    isolation: isolate;
    position: relative;

    & canvas {
      contain: strict;
      display: block;
      position: absolute;
      inset: 0;
      z-index: -1;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      corner-shape: inherit;
    }
  }
}`;

/** The parent `<div>` element that has a ShaderMount available on it */
export interface PaperShaderElement extends HTMLElement {
  paperShaderMount?: ShaderMount | undefined;
}

/**
 * Uniform types that we support to be auto-mapped into the fragment shader
 *
 * We accept undefined as a convenience for server rendering, when some things may be undefined
 * We just skip setting the uniform if it's undefined. This allows the shader mount to still take up space during server rendering
 */
export interface ShaderMountUniforms {
  [key: string]:
    boolean | number | number[] | number[][] | HTMLImageElement | undefined;
}

/** Opt-in scalar sizing derivation immediately before a draw; dimensions are buffer pixels. */
export type ShaderSizingAnimation = (
  milliseconds: number,
  baseline: Readonly<ShaderMountUniforms>,
  width: number,
  height: number,
) => { u_scale: number; u_offsetX: number; u_offsetY: number };

function isSafari() {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("safari") && !ua.includes("chrome") && !ua.includes("android")
  );
}

// Zoom level can be estimated comparing the browser's outerWidth and the viewport width.
// It's nowhere near perfect because it's affected by the presence of browser sidebars,
// like a vertical web inspector or Arc's sidebar. Also, both outerWidth and innerWidth
// are integers, which would almost never give us a perfect ratio at face values.
//
// Still, this is pretty accurate in the vast majority of cases.
//
// Note 1:
// Avoid innerWidth, use visualViewport.width instead.
// - innerWidth is affected by pinch zoom in Safari, but not other browsers.
//   visualViewport.width works consistently in all browsers.
// - innerWidth is rounded to integer, but not visualViewport.width.
// - visualViewport.width is affected by hard scrollbars, so they need to be added manually
//
// Note 2:
// Opening a sidebar in Safari like web inspector or bookmarks will throw off the zoom
// level detection and result in a larger target resolution. Not a concern in real-world usage
// with Safari, but we'd rather not try to detect zoom levels with other browsers
// (e.g. Arc always has a sidebar, which affects outerWidth vs visualViewport.width).
function bestGuessBrowserZoom(doc: Document) {
  const viewportScale = visualViewport?.scale ?? 1;
  const viewportWidth = visualViewport?.width ?? window.innerWidth;
  const scrollbarWidth = window.innerWidth - doc.documentElement.clientWidth;
  const innerWidth = viewportScale * viewportWidth + scrollbarWidth;

  // outerWidth and innerWidth are always integers so we won't often get the original zoom ratio
  // E.g. given a 125% zoom, outerWidth = 1657, innerWidth = 1325, 1657 / 1325 = 1.2505660377
  // We check for common zoom levels and return the closest one if found.

  const ratio = outerWidth / innerWidth;
  const zoomPercentageRounded = Math.round(100 * ratio);

  // All zoom levels divisible by 5%
  if (zoomPercentageRounded % 5 === 0) {
    return zoomPercentageRounded / 100;
  }

  // 33% zoom
  if (zoomPercentageRounded === 33) {
    return 1 / 3;
  }

  // 67% zoom
  if (zoomPercentageRounded === 67) {
    return 2 / 3;
  }

  // 133% zoom
  if (zoomPercentageRounded === 133) {
    return 4 / 3;
  }

  return ratio;
}
