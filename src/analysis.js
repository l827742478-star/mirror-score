import {
  COLOR_LIBRARY,
  DISCLAIMER,
  FEATURE_LIBRARY,
  MAKEUP_LIBRARY,
  STYLE_LIBRARY,
} from './data.js';

export const STORAGE_KEY = 'mirror-score:last-report-v2';
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const REQUIRED_METRICS = [
  'faceRatio',
  'eyeSpacingRatio',
  'eyeLevelRatio',
  'noseMouthRatio',
  'symmetry',
  'yaw',
  'pitch',
  'lighting',
  'sharpness',
  'faceCoverage',
];

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const scoreNear = (value, ideal, tolerance) => clampScore(100 - (Math.abs(value - ideal) / tolerance) * 100);
const scoreError = (value, maximum) => clampScore(100 - (Math.abs(value) / maximum) * 100);

const getStorage = (storage) => {
  if (storage) return storage;
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
};

export const validateImage = (file) => {
  if (!file) return { ok: false, message: '请先选择一张图片' };
  if (!SUPPORTED_TYPES.has(file.type)) {
    return { ok: false, message: '请选择 JPG、PNG 或 WEBP 图片' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, message: '图片需要小于 8MB' };
  }
  return { ok: true };
};

export const validateFaceAnalysis = (analysis) => {
  if (!analysis || analysis.ok !== true) {
    return { ok: false, message: '必须先完成真实人脸检测' };
  }
  if (analysis.faceCount === 0) {
    return { ok: false, message: '没有检测到清晰的人脸，请换一张正面照片' };
  }
  if (analysis.faceCount > 1) {
    return { ok: false, message: '检测到多张人脸，请只保留一张脸' };
  }
  if (analysis.faceCount !== 1 || !analysis.metrics) {
    return { ok: false, message: '人脸分析数据不完整，请重新上传照片' };
  }
  const complete = REQUIRED_METRICS.every((key) => Number.isFinite(analysis.metrics[key]));
  return complete
    ? { ok: true }
    : { ok: false, message: '人脸分析数据不完整，请重新上传照片' };
};

const hashString = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const measuredScoreRows = (metrics) => [
  {
    label: '脸型',
    score: scoreNear(metrics.faceRatio, 0.78, 0.26),
    note: `宽高比 ${metrics.faceRatio.toFixed(2)}`,
  },
  {
    label: '比例',
    score: clampScore(average([
      scoreNear(metrics.eyeSpacingRatio, 0.31, 0.18),
      scoreNear(metrics.noseMouthRatio, 0.22, 0.16),
    ])),
    note: `眼距 ${metrics.eyeSpacingRatio.toFixed(2)}`,
  },
  {
    label: '五官协调',
    score: clampScore(average([
      metrics.symmetry * 100,
      scoreError(metrics.eyeLevelRatio, 0.08),
      scoreError(metrics.yaw, 0.16),
    ])),
    note: `左右对称 ${Math.round(metrics.symmetry * 100)}%`,
  },
  {
    label: '轮廓',
    score: clampScore(average([
      scoreNear(metrics.faceRatio, 0.78, 0.26),
      metrics.symmetry * 100,
      scoreError(metrics.pitch, 0.16),
    ])),
    note: `轮廓占比 ${Math.round(metrics.faceCoverage * 100)}%`,
  },
  {
    label: '镜头表现',
    score: clampScore(average([
      metrics.lighting * 100,
      metrics.sharpness * 100,
      scoreError(metrics.yaw, 0.16),
      scoreError(metrics.pitch, 0.16),
    ])),
    note: `光线 ${Math.round(metrics.lighting * 100)}%`,
  },
];

const featureScores = (metrics) => [
  clampScore(average([
    scoreNear(metrics.eyeSpacingRatio, 0.31, 0.18),
    scoreError(metrics.eyeLevelRatio, 0.08),
  ])),
  scoreNear(metrics.noseMouthRatio, 0.22, 0.16),
  clampScore(average([scoreNear(metrics.noseMouthRatio, 0.22, 0.16), metrics.symmetry * 100])),
  clampScore(average([scoreNear(metrics.faceRatio, 0.78, 0.26), metrics.symmetry * 100])),
];

const selectStyle = (metrics) => {
  if (metrics.lighting >= 0.72 && metrics.sharpness >= 0.64) return STYLE_LIBRARY[2];
  if (metrics.symmetry >= 0.87 && metrics.faceRatio >= 0.70) return STYLE_LIBRARY[0];
  if (metrics.faceRatio >= 0.76 && metrics.yaw <= 0.06) return STYLE_LIBRARY[1];
  return STYLE_LIBRARY[3];
};

export const createReport = ({ fileMeta, gender = 'neutral', faceAnalysis }) => {
  const validation = validateFaceAnalysis(faceAnalysis);
  if (!validation.ok) throw new Error(validation.message);

  const metrics = faceAnalysis.metrics;
  const dimensions = measuredScoreRows(metrics);
  const totalScore = clampScore(average(dimensions.map((dimension) => dimension.score)));
  const style = selectStyle(metrics);
  const scores = featureScores(metrics);
  const features = FEATURE_LIBRARY.map((feature, index) => ({
    ...feature,
    score: scores[index],
  }));
  const priorityIndex = metrics.lighting < 0.55 ? 0 : metrics.symmetry < 0.78 ? 1 : 2;
  const makeup = MAKEUP_LIBRARY.map((item, index) => ({
    ...item,
    priority: index === priorityIndex ? '优先尝试' : '可以尝试',
  }));
  const evidence = {
    detector: faceAnalysis.detector || 'MediaPipe Face Landmarker',
    model: faceAnalysis.model || 'face_landmarker.task',
    faceCount: faceAnalysis.faceCount,
    metrics: Object.fromEntries(REQUIRED_METRICS.map((key) => [key, Number(metrics[key].toFixed(3))])),
  };
  const id = hashString(JSON.stringify({ name: fileMeta.name, evidence })).toString(16).padStart(8, '0');

  return {
    id: `mirror-${id}`,
    createdAt: new Date(fileMeta.lastModified || Date.now()).toISOString(),
    gender,
    imagePreview: fileMeta.preview || '',
    imageName: fileMeta.name || '未命名照片',
    totalScore,
    style: {
      name: style.name,
      summary: style.summary,
      tags: [...style.tags],
    },
    dimensions,
    comparisons: {
      east: {
        label: '东方审美',
        score: clampScore(average([dimensions[1].score, dimensions[2].score, dimensions[3].score])),
        note: '更强调留白、柔和转折与整体协调。',
      },
      global: {
        label: '国际审美',
        score: clampScore(average([dimensions[0].score, dimensions[3].score, dimensions[4].score])),
        note: '更关注轮廓识别度与镜头中的明暗关系。',
      },
    },
    sections: {
      features,
      makeup,
    },
    colors: {
      suitable: COLOR_LIBRARY.suitable.map((color) => ({ ...color })),
      caution: COLOR_LIBRARY.caution.map((color) => ({ ...color })),
      recommendation: style.tags[2],
    },
    analysisEvidence: evidence,
    conclusion: `本次结果基于一张已检测到的人脸，结合面部关键点、比例、对称性、姿态与照片光线计算；你的${style.tags[0]}与${style.tags[1]}是当前画面里的主要特征。`,
    disclaimer: DISCLAIMER,
  };
};

export const saveReport = (report, storage) => {
  const target = getStorage(storage);
  if (!target) return false;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
};

const isReport = (value) => Boolean(
  value
  && typeof value === 'object'
  && typeof value.id === 'string'
  && typeof value.totalScore === 'number'
  && value.style && typeof value.style.name === 'string'
  && Array.isArray(value.dimensions) && value.dimensions.length === 5
  && value.comparisons && value.comparisons.east && value.comparisons.global
  && value.sections && Array.isArray(value.sections.features) && value.sections.features.length === 4
  && Array.isArray(value.sections.makeup) && value.sections.makeup.length === 3
  && value.colors && Array.isArray(value.colors.suitable) && Array.isArray(value.colors.caution)
  && value.analysisEvidence && value.analysisEvidence.faceCount === 1
  && typeof value.disclaimer === 'string'
);

export const loadReport = (storage) => {
  const target = getStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
