// Fullscreen pass: physical-space rays from an orthographic camera.
export const vertexShader = `
precision highp float;
in vec3 position;
out vec2 ndc;
void main() { ndc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const fragmentShader = `
precision highp float;
precision highp sampler3D;
in vec2 ndc;
out vec4 fragColor;
uniform sampler3D volume;
uniform vec3 eye, rightAxis, upAxis, direction, extent, dimensions;
uniform vec2 halfView, redRange, greenRange, gammaValue, visibleChannels;
uniform vec3 cropLow, cropHigh;
uniform float voxelStep, quality;

bool slab(float o, float d, float lo, float hi, inout float nearT, inout float farT) {
  if (abs(d) < 1e-7) return o >= lo && o <= hi;
  float a = (lo - o) / d, b = (hi - o) / d;
  nearT = max(nearT, min(a, b)); farT = min(farT, max(a, b));
  return nearT <= farT;
}
float displayValue(float value, vec2 limits, float gamma) {
  return pow(clamp((value - limits.x) / max(limits.y - limits.x, 1e-6), 0.0, 1.0), 1.0 / gamma);
}
void main() {
  vec3 origin = eye + rightAxis * ndc.x * halfView.x + upAxis * ndc.y * halfView.y;
  vec3 lo = (cropLow - 0.5) * extent, hi = (cropHigh - 0.5) * extent;
  float nearT = 0.0, farT = 1e6;
  if (!slab(origin.x, direction.x, lo.x, hi.x, nearT, farT)
   || !slab(origin.y, direction.y, lo.y, hi.y, nearT, farT)
   || !slab(origin.z, direction.z, lo.z, hi.z, nearT, farT)) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
  }
  // Midpoint samples hit voxel centers for the axis-aligned validation view.
  int count = int(clamp(ceil((farT - nearT) / (voxelStep * quality)), 1.0, 2048.0));
  vec2 maxima = vec2(0.0);
  vec3 centerLo = cropLow + 0.5 / dimensions;
  vec3 centerHi = cropHigh - 0.5 / dimensions;
  for (int i = 0; i < 2048; i++) {
    if (i >= count) break;
    float t = mix(nearT, farT, (float(i) + 0.5) / float(count));
    vec3 uvw = (origin + t * direction) / extent + 0.5;
    // Clamp to retained voxel centers: cropped-out voxels cannot bleed in.
    vec2 signal = texture(volume, clamp(uvw, centerLo, centerHi)).rg;
    maxima = max(maxima, signal); // Independent channel maxima; never choose a winning voxel.
  }
  fragColor = vec4(displayValue(maxima.r, redRange, gammaValue.r) * visibleChannels.r,
                   displayValue(maxima.g, greenRange, gammaValue.g) * visibleChannels.g, 0.0, 1.0);
  // Deliberately no tone mapping or sRGB conversion: bytes match imshow RGB display data.
}
`;
