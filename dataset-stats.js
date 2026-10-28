(() => {
  'use strict';

  function initializeDatasetStats() {
    document.querySelectorAll('[data-dataset-stats]').forEach((root) => {
      const buttons = [...root.querySelectorAll('[data-stats-metric]')];
      const rows = [...root.querySelectorAll('[data-stats-row]')];
      const heading = root.querySelector('[data-stats-heading]');
      const scale = root.querySelector('[data-stats-scale]');
      const status = root.querySelector('[data-stats-status]');
      const formatNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
      const metrics = {
        duration: { heading: 'Duration (hours)', maximum: 5048, unit: 'hours' },
        sequences: { heading: 'Motion sequences', maximum: 3200000, unit: 'sequences' }
      };

      function showMetric(metric, announce = false) {
        const config = metrics[metric];
        if (!config) return;

        buttons.forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset.statsMetric === metric));
        });
        heading.textContent = config.heading;
        scale.textContent = `Linear scale · 0–${formatNumber.format(config.maximum)} ${config.unit}`;
        rows.forEach((row) => {
          const value = Number(row.dataset[metric]);
          row.querySelector('[data-stats-value]').textContent = formatNumber.format(value);
          row.querySelector('[data-stats-bar]').style.width = `${value / config.maximum * 100}%`;
        });
        if (announce) status.textContent = `Showing ${config.heading.toLowerCase()} for seven datasets.`;
      }

      buttons.forEach((button) => {
        button.addEventListener('click', () => showMetric(button.dataset.statsMetric, true));
      });
      showMetric('duration');
      root.querySelector('[data-stats-controls]').hidden = false;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDatasetStats, { once: true });
  } else {
    initializeDatasetStats();
  }
})();
