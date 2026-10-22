import { createReport, loadReport, saveReport, validateImage } from './analysis.js';

const app = document.querySelector('#app');
const fileInput = document.querySelector('#file-input');
const dropzone = document.querySelector('#dropzone');
const startError = document.querySelector('#start-error');
const previewImage = document.querySelector('#preview-image');
const previewPlaceholder = document.querySelector('#preview-placeholder');
const previewName = document.querySelector('#preview-name');
const previewSize = document.querySelector('#preview-size');
const analyzeButton = document.querySelector('#analyze-button');
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const posterDialog = document.querySelector('#poster-dialog');
const posterContent = document.querySelector('#poster-content');
const toast = document.querySelector('#toast');
const SAMPLE_IMAGE = './assets/taiwan-beauty-sample.png';

const viewIds = ['start', 'settings', 'progress', 'report'];
const state = {
  view: 'start',
  fileMeta: null,
  gender: 'neutral',
  report: loadReport(),
  storageWarning: false,
};

let toastTimer;

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const showToast = (message) => {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
};

const setView = (view) => {
  state.view = view;
  viewIds.forEach((name) => {
    const section = document.querySelector(`[data-view="${name}"]`);
    section.hidden = name !== view;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const setStartError = (message = '') => {
  startError.textContent = message;
  startError.hidden = !message;
};

const formatSize = (size) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))}KB` : `${(size / 1024 / 1024).toFixed(1)}MB`;

const setPreview = (meta) => {
  state.fileMeta = meta;
  previewName.textContent = meta.name || '示例照片';
  previewSize.textContent = meta.size ? `${formatSize(meta.size)} · 本地预览` : '原创示例 · 本地预览';
  if (meta.preview) {
    previewImage.src = meta.preview;
    previewImage.hidden = false;
    previewPlaceholder.hidden = true;
    previewImage.onerror = () => {
      previewImage.hidden = true;
      previewPlaceholder.hidden = false;
      showToast('照片预览暂时不可用，已使用渐变占位。');
    };
  } else {
    previewImage.hidden = true;
    previewPlaceholder.hidden = false;
  }
  analyzeButton.disabled = false;
};

const readFile = (file) => {
  const validation = validateImage(file);
  if (!validation.ok) {
    setStartError(validation.message);
    return;
  }
  setStartError('');
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    setPreview({
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      preview: typeof reader.result === 'string' ? reader.result : '',
    });
    setView('settings');
  });
  reader.addEventListener('error', () => setStartError('照片读取失败，请换一张图片再试。'));
  reader.readAsDataURL(file);
};

const chooseExample = () => {
  setStartError('');
  setPreview({
    name: 'mirror-taiwan-beauty-sample.png',
    type: 'image/png',
    size: 184_000,
    lastModified: 1_725_000_000_000,
    preview: SAMPLE_IMAGE,
  });
  setView('settings');
};

const setGender = (gender) => {
  state.gender = gender;
  document.querySelectorAll('[data-gender]').forEach((button) => {
    const selected = button.dataset.gender === gender;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
};

const updateProgress = (stage, label, width) => {
  progressBar.style.width = `${width}%`;
  progressLabel.textContent = `${label} · 0${stage}`;
  document.querySelectorAll('.progress-stages span').forEach((item, index) => item.classList.toggle('is-active', index === stage - 1));
};

const startAnalysis = () => {
  if (!state.fileMeta) {
    showToast('请先选择照片。');
    setView('start');
    return;
  }
  setView('progress');
  updateProgress(1, '读取轮廓', 20);
  setTimeout(() => updateProgress(2, '拆解五官', 56), 560);
  setTimeout(() => updateProgress(3, '生成建议', 82), 1120);
  setTimeout(() => {
    const report = createReport({ fileMeta: state.fileMeta, gender: state.gender });
    state.report = report;
    state.storageWarning = !saveReport({ ...report, imagePreview: report.imagePreview?.length > 240_000 ? '' : report.imagePreview });
    renderReport(report);
    setView('report');
    if (state.storageWarning) showToast('报告已生成，但浏览器未允许持久保存。');
  }, 1680);
};

const renderScoreRows = (dimensions) => dimensions.map((dimension) => `
  <div class="dimension-row">
    <span>${escapeHtml(dimension.label)}</span>
    <div class="dimension-bar"><i style="--score:${dimension.score}%"></i></div>
    <b>${dimension.score}</b>
    <small>${escapeHtml(dimension.note)}</small>
  </div>`).join('');

const renderFeatureCards = (features) => features.map((feature, index) => `
  <article class="feature-card">
    <div class="feature-number"><span>0${index + 1} / ${escapeHtml(feature.eyebrow)}</span><strong class="feature-score">${feature.score}</strong></div>
    <h3>${escapeHtml(feature.title)}</h3>
    <p class="insight">${escapeHtml(feature.insight)}</p>
    <span class="feature-label">可优化的细节</span>
    <ul>${feature.optimize.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </article>`).join('');

const renderColors = (colors, caution = false) => colors.map((color) => `<span class="swatch${caution ? ' caution' : ''}"><i style="--swatch:${color.value}"></i>${escapeHtml(color.name)}</span>`).join('');

const renderReport = (report) => {
  const preview = report.imagePreview ? `<img src="${escapeHtml(report.imagePreview)}" alt="本次报告照片" />` : '<div class="summary-placeholder" aria-hidden="true">✦</div>';
  const comparisons = ['east', 'global'].map((key) => {
    const item = report.comparisons[key];
    return `<div class="compare-item"><span>${escapeHtml(item.label)}</span><div class="dimension-bar"><i style="--score:${item.score}%"></i></div><b>${item.score}</b><small>${escapeHtml(item.note)}</small></div>`;
  }).join('');
  const makeupIcons = ['◒', '✧', '◌'];

  document.querySelector('#report-content').innerHTML = `
    <section class="report-section summary-section">
      <div class="summary-copy">
        <p class="section-kicker">YOUR MIRROR REPORT · ${escapeHtml(report.imageName)}</p>
        <h1 id="report-heading">这张脸的关键词<br /><span>${escapeHtml(report.style.name)}</span></h1>
        <p class="section-note">${escapeHtml(report.conclusion)}</p>
        <div class="tag-row">${report.style.tags.map((tag, index) => `<span class="pill${index === 1 ? ' pink' : ''}">${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="score-bubble"><strong>${report.totalScore}</strong><span>/ 100 · 综合观察分</span></div>
      </div>
      <div class="summary-image">${preview}</div>
    </section>

    <section class="report-section dimensions-section">
      <p class="section-kicker">01 / QUICK READ</p><h2 class="section-title">五个维度，先看整体节奏</h2>
      <div class="dimension-list">${renderScoreRows(report.dimensions)}</div>
    </section>

    <div class="split-grid">
      <section class="report-section style-section">
        <p class="section-kicker">02 / STYLE CODE</p><h2 class="section-title">风格定位</h2>
        <div class="style-mark" aria-hidden="true">✦</div><h3>${escapeHtml(report.style.name)}</h3><p>${escapeHtml(report.style.summary)}</p>
      </section>
      <section class="report-section compare-section">
        <p class="section-kicker">03 / REFERENCE</p><h2 class="section-title">审美参照</h2>
        <div class="compare-grid">${comparisons}</div>
      </section>
    </div>

    <section class="feature-section">
      <div class="section-heading"><p class="section-kicker">04 / FEATURE NOTES</p><h2 class="section-title">把五官拆开看，建议会更具体</h2></div>
      <div class="feature-grid">${renderFeatureCards(report.sections.features)}</div>
    </section>

    <section class="report-section makeup-section">
      <p class="section-kicker">05 / SMALL CHANGES</p><h2 class="section-title">专业化妆建议</h2>
      <div class="makeup-list">${report.sections.makeup.map((item, index) => `<div class="makeup-item"><span class="makeup-icon" aria-hidden="true">${makeupIcons[index]}</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.detail)}</p></div><span class="pill pink">${escapeHtml(item.priority)}</span></div>`).join('')}</div>
    </section>

    <section class="report-section color-section">
      <p class="section-kicker">06 / COLOR NOTES</p><h2 class="section-title">颜色先替你说话</h2>
      <div class="color-group"><div class="color-label">适合你的颜色 · ${escapeHtml(report.colors.recommendation)}</div><div class="color-swatches">${renderColors(report.colors.suitable)}</div></div>
      <div class="color-group"><div class="color-label">可以少一点的颜色</div><div class="color-swatches">${renderColors(report.colors.caution, true)}</div></div>
    </section>

    <section class="report-section action-section">
      <div><p class="section-kicker">07 / TAKE IT WITH YOU</p><h2 class="section-title">把这份观察带走</h2><p class="section-note">保存、分享，或者换一张照片再看看。</p></div>
      <div class="action-buttons"><button class="secondary-button" type="button" data-action="download-report">下载报告 ↓</button><button class="pink-button" type="button" data-action="open-poster">生成海报 ↗</button><button class="secondary-button" type="button" data-action="reset-settings">重新分析 ↺</button></div>
    </section>
    <p class="disclaimer">${escapeHtml(report.disclaimer)}</p>`;
};

const renderPoster = (report) => {
  posterContent.innerHTML = `<div class="poster-card"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><span><strong>镜面分数</strong><small>MIRROR SCORE</small></span></div><h2>你的脸，<br /><span>有自己的节奏。</span></h2><p>${escapeHtml(report.style.summary)}</p><div class="poster-score"><strong>${report.totalScore}</strong><span>/ 100</span></div><div class="poster-advice"><span>✦ ${escapeHtml(report.style.tags[0])}</span><span>✦ ${escapeHtml(report.sections.makeup[0].chip)}</span><span>✦ ${escapeHtml(report.colors.recommendation)} 是你的推荐色</span></div><span class="poster-code">MIRROR SCORE · ${escapeHtml(report.id.slice(-6).toUpperCase())}</span></div>`;
};

const openPoster = () => {
  if (!state.report) return;
  renderPoster(state.report);
  if (typeof posterDialog.showModal === 'function') posterDialog.showModal();
  else posterDialog.setAttribute('open', '');
};

const downloadReport = () => {
  if (!state.report) return;
  const report = state.report;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>镜面分数报告</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#241d31;background:#f6f1ff}section{background:#fff;border-radius:18px;padding:24px;margin:14px 0}h1{font-size:38px}h2{font-size:20px;color:#6d3ca7}li{margin:8px 0;color:#655b6f}.score{font-size:56px;font-weight:800;color:#9555d8}</style><h1>镜面分数报告</h1><p>${escapeHtml(report.imageName)} · ${escapeHtml(report.style.name)}</p><section><div class="score">${report.totalScore}<small>/100</small></div><p>${escapeHtml(report.conclusion)}</p></section><section><h2>五维观察</h2><ul>${report.dimensions.map((item) => `<li>${escapeHtml(item.label)}：${item.score} · ${escapeHtml(item.note)}</li>`).join('')}</ul></section><section><h2>五官建议</h2>${report.sections.features.map((item) => `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.insight)}</p><ul>${item.optimize.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>`).join('')}</section><p>${escapeHtml(report.disclaimer)}</p></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  if (!window.URL?.createObjectURL) {
    showToast('当前浏览器不支持文件下载，请使用浏览器打印保存。');
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mirror-score-${report.id.slice(-8)}.html`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('报告已下载，可以继续编辑或打印。');
};

const resetToSettings = () => {
  if (state.report && !state.fileMeta) {
    setPreview({ name: state.report.imageName, type: 'image/png', size: 0, lastModified: Date.parse(state.report.createdAt), preview: state.report.imagePreview });
  }
  setView(state.fileMeta ? 'settings' : 'start');
};

const handleAction = (action) => {
  if (action === 'choose-file') fileInput.click();
  if (action === 'example-photo') chooseExample();
  if (action === 'start-analysis') startAnalysis();
  if (action === 'back-start') setView('start');
  if (action === 'reset-settings') resetToSettings();
  if (action === 'open-poster') openPoster();
  if (action === 'close-poster') posterDialog.close?.();
  if (action === 'download-report') downloadReport();
};

app.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) handleAction(actionTarget.dataset.action);
  const genderButton = event.target.closest('[data-gender]');
  if (genderButton) setGender(genderButton.dataset.gender);
});

posterDialog.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) handleAction(actionTarget.dataset.action);
});

fileInput.addEventListener('change', () => readFile(fileInput.files?.[0]));
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('is-dragging'); readFile(event.dataTransfer.files?.[0]); });

if (state.report) {
  renderReport(state.report);
  setView('report');
} else {
  analyzeButton.disabled = true;
  setView('start');
}
