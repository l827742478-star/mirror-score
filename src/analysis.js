import {
  COLOR_LIBRARY,
  DISCLAIMER,
  FEATURE_LIBRARY,
  MAKEUP_LIBRARY,
  STYLE_LIBRARY,
} from './data.js';

export const STORAGE_KEY = 'mirror-score:last-report-v1';
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

const hashString = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

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

const getSeed = (fileMeta, gender) => hashString([
  fileMeta.name,
  fileMeta.type,
  fileMeta.size,
  fileMeta.lastModified || 0,
  gender,
].join('|'));

const scoreList = (seed, totalScore) => {
  const labels = ['脸型', '比例', '五官协调', '轮廓', '镜头表现'];
  const offsets = [-3, 2, 1, -1, 4];
  return labels.map((label, index) => ({
    label,
    score: clampScore(totalScore + offsets[index] + ((seed >>> (index * 3)) % 5) - 2),
    note: ['线条转折', '留白节奏', '视觉重心', '外轮廓', '光线适配'][index],
  }));
};

export const createReport = ({ fileMeta, gender = 'neutral' }) => {
  const seed = getSeed(fileMeta, gender);
  const totalScore = clampScore(74 + (seed % 15));
  const style = STYLE_LIBRARY[seed % STYLE_LIBRARY.length];
  const dimensions = scoreList(seed, totalScore);
  const features = FEATURE_LIBRARY.map((feature, index) => ({
    ...feature,
    score: clampScore(totalScore + ((seed >>> (index + 6)) % 9) - 4),
  }));
  const makeup = MAKEUP_LIBRARY.map((item, index) => ({
    ...item,
    priority: index === seed % MAKEUP_LIBRARY.length ? '优先尝试' : '可以尝试',
  }));

  return {
    id: `mirror-${seed.toString(16).padStart(8, '0')}`,
    createdAt: new Date(fileMeta.lastModified || 0).toISOString(),
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
        score: clampScore(totalScore + 2),
        note: '更强调留白、柔和转折与整体协调。',
      },
      global: {
        label: '国际审美',
        score: clampScore(totalScore - 1),
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
    conclusion: `你的优势是${style.tags[0]}与${style.tags[1]}，先从一处小调整开始，变化会比追求全套改造更自然。`,
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
  && typeof value.disclaimer === 'string',
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
