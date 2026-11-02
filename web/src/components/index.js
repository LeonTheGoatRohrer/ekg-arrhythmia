// Public entry point of the chart components (contract: INTERFACES.md).
// Every function: render…(container, data, opts?) -> { destroy() }.
// data null/undefined or status "pending" -> explanatory empty state.

export { renderEcgChart } from './ecg-chart.js';
export { renderPanTompkins } from './pan-tompkins.js';
export { renderFilterResponse } from './filter-response.js';
export { renderBeatGallery } from './beat-gallery.js';
export { renderArchitecture } from './architecture.js';
export { renderTrainingCurve } from './training-curve.js';
export { renderConfusionMatrix } from './confusion-matrix.js';
export { renderTreeView } from './tree-view.js';
export { renderDatasetStats } from './dataset-stats.js';
export { renderRhythmPlayer } from './rhythm-player.js';
