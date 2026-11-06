"use client";

/*
 * Liquid glass surface, ported from dashersw/liquid-glass-js (MIT, (c) dashersw).
 * Like the original, it refracts a one-off html2canvas snapshot of the page through
 * a WebGL shader, so what shows through the glass is the page as captured, not live
 * content. Changes from the original: React lifecycle, typed, devicePixelRatio-aware,
 * snapshot scaled to the GPU texture limit, re-captured on resize, and the per-pixel
 * "sampled gradient" pass dropped (≈660 texture reads per pixel for a barely visible
 * tint). A CSS backdrop blur stays underneath as the fallback when WebGL is missing.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Snapshot = {
  image: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
};

let snapshot: Promise<Snapshot> | null = null;
const listeners = new Set<(s: Snapshot) => void>();

async function capture(): Promise<Snapshot> {
  await document.fonts.ready;
  // Let the hero intro settle so it isn't captured mid-animation.
  await new Promise((r) => setTimeout(r, 1800));
  const { default: html2canvas } = await import("html2canvas-pro");
  const pageWidth = document.documentElement.scrollWidth;
  const pageHeight = document.documentElement.scrollHeight;
  const probe = document.createElement("canvas").getContext("webgl");
  const maxTexture = probe?.getParameter(probe.MAX_TEXTURE_SIZE) ?? 4096;
  const scale = Math.min(1, maxTexture / pageHeight, maxTexture / pageWidth);
  const image = await html2canvas(document.body, {
    scale,
    backgroundColor: "#ffffff",
    logging: false,
    ignoreElements: (el) => el.hasAttribute("data-glass"),
  });
  return { image, pageWidth, pageHeight };
}

function requestSnapshot(): Promise<Snapshot> {
  snapshot ??= capture();
  return snapshot;
}

if (typeof window !== "undefined") {
  let timer: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!listeners.size) return;
      snapshot = null;
      requestSnapshot().then((s) => listeners.forEach((l) => l(s)));
    }, 500);
  });
}

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x, -a_position.y) * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_size;      // glass size, CSS px
uniform vec2 u_center;    // glass center, page px
uniform vec2 u_page;      // page size, CSS px
uniform vec2 u_texel;     // 1 / texture size
uniform float u_radius;
uniform float u_tint;
varying vec2 v_uv;

float roundedBox(vec2 p, vec2 half, float r) {
  vec2 q = abs(p) - (half - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = (v_uv - 0.5) * u_size;
  vec2 half = u_size * 0.5;
  float r = min(u_radius, min(half.x, half.y));
  float d = roundedBox(p, half, r);
  float inside = max(-d, 0.0);

  // Normal points away from the shape's core (capsule axis for pills).
  vec2 core = clamp(p, -(half - r), half - r);
  vec2 n = length(p - core) > 0.0 ? normalize(p - core) : normalize(p + 1e-4);

  float edge = exp(-inside * 0.15) * 0.01;
  float rim = exp(-inside * 0.8) * 0.05;
  float base = (1.0 - exp(-inside * 0.1)) * 0.01;
  vec2 corner = min(v_uv, 1.0 - v_uv);
  float boost = exp(-max(corner.x, corner.y) * min(u_size.x, u_size.y) * 0.3) * 0.02;
  float ripple = sin(inside / min(u_size.x, u_size.y) * 25.0) * 0.1 * rim;
  vec2 refraction = n * (edge + rim + base + boost) + vec2(-n.y, n.x) * ripple;

  vec2 uv = (u_center + p) / u_page + refraction;

  vec4 color = vec4(0.0);
  float total = 0.0;
  for (float i = -6.0; i <= 6.0; i += 1.0) {
    for (float j = -6.0; j <= 6.0; j += 1.0) {
      float k = length(vec2(i, j));
      if (k > 6.0) continue;
      float w = exp(-(k * k) / 12.5);
      color += texture2D(u_image, uv + vec2(i, j) * u_texel * 2.5) * w;
      total += w;
    }
  }
  color /= total;

  vec3 tint = mix(vec3(1.0), vec3(0.82), v_uv.y);
  vec3 rgb = mix(color.rgb, tint, u_tint);
  float mask = 1.0 - smoothstep(-1.0, 1.0, d);
  gl_FragColor = vec4(rgb * mask, mask);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

type Props = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 0 = clear glass, 1 = milky. */
  tint?: number;
  as?: "div" | "header" | "aside";
};

export function LiquidGlass({
  children,
  className = "",
  style,
  tint = 0.35,
  as: Tag = "div",
}: Props) {
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = root.current!;
    const cv = canvas.current!;
    const gl = cv.getContext("webgl", { premultipliedAlpha: true });
    if (!gl) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const pos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const [uSize, uCenter, uPage, uTexel, uRadius, uTint] = [
      "u_size",
      "u_center",
      "u_page",
      "u_texel",
      "u_radius",
      "u_tint",
    ].map(u);
    gl.uniform1f(uTint, tint);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);

    let ready = false;
    let last = "";
    let frame = 0;
    let visible = true;

    const draw = () => {
      frame = visible ? requestAnimationFrame(draw) : 0;
      if (!ready) return;
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // The shape comes from CSS (border-radius), so it can animate with the element.
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const key = `${rect.x},${rect.y},${rect.width},${rect.height},${radius},${scrollY},${dpr}`;
      if (key === last) return;
      last = key;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uSize, rect.width, rect.height);
      gl.uniform2f(
        uCenter,
        rect.x + scrollX + rect.width / 2,
        rect.y + scrollY + rect.height / 2,
      );
      gl.uniform1f(uRadius, radius);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const load = (s: Snapshot) => {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        s.image,
      );
      gl.uniform2f(uPage, s.pageWidth, s.pageHeight);
      gl.uniform2f(uTexel, 1 / s.image.width, 1 / s.image.height);
      ready = true;
      last = "";
      cv.style.opacity = "1";
    };

    listeners.add(load);
    requestSnapshot().then(load, () => {});

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) frame = requestAnimationFrame(draw);
    });
    io.observe(el);
    frame = requestAnimationFrame(draw);

    return () => {
      listeners.delete(load);
      io.disconnect();
      cancelAnimationFrame(frame);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [tint]);

  // Only an unprefixed position class replaces `relative`; responsive ones (sm:absolute) layer on top.
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className);

  return (
    <Tag
      ref={root as never}
      data-glass=""
      className={`${positioned ? "" : "relative"} isolate ${className}`}
      style={style}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-20 rounded-[inherit] bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl backdrop-saturate-150"
      />
      <canvas
        ref={canvas}
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 size-full rounded-[inherit] opacity-0 transition-opacity duration-700"
      />
      {children}
    </Tag>
  );
}
