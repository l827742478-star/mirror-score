const VISION_VERSION = '1.1.1';
const VISION_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const EYE_LEFT = [33, 133, 159, 145];
const EYE_RIGHT = [263, 362, 386, 374];
const SYMMETRY_PAIRS = [[33, 263], [133, 362], [61, 291], [70, 300], [105, 334], [234, 454], [93, 323]];

let landmarkerPromise;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const pointAt = (landmarks, index) => landmarks[index] || { x: 0.5, y: 0.5, z: 0 };

const meanPoint = (landmarks, indices) => indices.reduce((sum, index) => {
  const point = pointAt(landmarks, index);
  return { x: sum.x + point.x / indices.length, y: sum.y + point.y / indices.length, z: sum.z + point.z / indices.length };
}, { x: 0, y: 0, z: 0 });

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const boundsOf = (landmarks) => landmarks.reduce((bounds, point) => ({
  minX: Math.min(bounds.minX, point.x),
  maxX: Math.max(bounds.maxX, point.x),
  minY: Math.min(bounds.minY, point.y),
  maxY: Math.max(bounds.maxY, point.y),
}), { minX: 1, maxX: 0, minY: 1, maxY: 0 });

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const deriveFaceMetrics = (landmarks, imageMetrics = {}) => {
  if (!Array.isArray(landmarks) || landmarks.length < 468) {
    throw new Error('人脸关键点数量不足');
  }

  const bounds = boundsOf(landmarks);
  const faceWidth = Math.max(bounds.maxX - bounds.minX, Number.EPSILON);
  const faceHeight = Math.max(bounds.maxY - bounds.minY, Number.EPSILON);
  const leftEye = meanPoint(landmarks, EYE_LEFT);
  const rightEye = meanPoint(landmarks, EYE_RIGHT);
  const eyeMid = meanPoint([leftEye, rightEye], [0, 1]);
  const nose = pointAt(landmarks, 1);
  const mouth = meanPoint(landmarks, [61, 291]);
  const eyeLine = Math.abs(leftEye.y - rightEye.y) / faceHeight;
  const noseToEyeRatio = (nose.y - eyeMid.y) / faceHeight;
  const symmetryErrors = SYMMETRY_PAIRS.map(([leftIndex, rightIndex]) => {
    const left = pointAt(landmarks, leftIndex);
    const right = pointAt(landmarks, rightIndex);
    const leftOffset = Math.abs(eyeMid.x - left.x);
    const rightOffset = Math.abs(right.x - eyeMid.x);
    return Math.abs(leftOffset - rightOffset) / faceWidth;
  });

  return {
    faceRatio: faceWidth / faceHeight,
    eyeSpacingRatio: distance(leftEye, rightEye) / faceWidth,
    eyeLevelRatio: eyeLine,
    noseMouthRatio: distance(nose, mouth) / faceHeight,
    symmetry: clamp01(1 - average(symmetryErrors) * 5),
    yaw: Math.abs(nose.x - eyeMid.x) / faceWidth,
    pitch: Math.abs(noseToEyeRatio - 0.21),
    lighting: clamp01(Number(imageMetrics.lighting ?? 0)),
    sharpness: clamp01(Number(imageMetrics.sharpness ?? 0)),
    faceCoverage: clamp01(Number(imageMetrics.faceCoverage ?? faceWidth * faceHeight)),
  };
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('照片读取失败，无法进行人脸检测'));
  image.src = src;
});

const imagePixels = (image) => {
  const width = Math.max(1, Math.min(320, image.naturalWidth || image.width));
  const height = Math.max(1, Math.min(320, Math.round(width * ((image.naturalHeight || image.height) / (image.naturalWidth || image.width)))));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器不支持照片像素分析');
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const luminance = new Float32Array(width * height);
  let total = 0;
  let clipped = 0;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const value = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
    luminance[pixel] = value;
    total += value;
    if (value < 0.05 || value > 0.95) clipped += 1;
  }
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      edgeTotal += Math.abs(luminance[index] - luminance[index - 1]);
      edgeTotal += Math.abs(luminance[index] - luminance[index - width]);
      edgeCount += 2;
    }
  }
  const mean = total / luminance.length;
  const clippedRatio = clipped / luminance.length;
  return {
    lighting: clamp01(1 - Math.abs(mean - 0.55) * 1.6 - clippedRatio * 2.2),
    sharpness: clamp01((edgeTotal / Math.max(edgeCount, 1) - 0.015) / 0.16),
    width,
    height,
  };
};

const getLandmarker = async () => {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(VISION_MODULE_URL);
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 2,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };
      try {
        return await FaceLandmarker.createFromOptions(fileset, options);
      } catch {
        return FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        });
      }
    })().catch((error) => {
      landmarkerPromise = undefined;
      throw error;
    });
  }
  return landmarkerPromise;
};

export const analyzeFaceImage = async (src, { onProgress = () => {} } = {}) => {
  onProgress({ stage: 1, label: '加载真实人脸模型', width: 18 });
  const [image, landmarker] = await Promise.all([loadImage(src), getLandmarker()]);
  onProgress({ stage: 2, label: '检测人脸关键点', width: 58 });
  const result = landmarker.detect(image);
  const faceCount = result.faceLandmarks?.length || 0;
  if (faceCount === 0) {
    return { ok: false, faceCount, message: '没有检测到清晰的人脸，请换一张正面照片' };
  }
  if (faceCount > 1) {
    return { ok: false, faceCount, message: '检测到多张人脸，请只保留一张脸' };
  }

  const landmarks = result.faceLandmarks[0];
  const bounds = boundsOf(landmarks);
  const pixels = imagePixels(image);
  const metrics = deriveFaceMetrics(landmarks, {
    lighting: pixels.lighting,
    sharpness: pixels.sharpness,
    faceCoverage: (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY),
  });
  onProgress({ stage: 3, label: '根据实测数据生成报告', width: 86 });
  return {
    ok: true,
    faceCount,
    metrics,
    detector: 'MediaPipe Face Landmarker',
    model: `face_landmarker.task · ${VISION_VERSION}`,
  };
};
