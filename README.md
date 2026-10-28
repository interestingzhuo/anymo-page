# AnyMo project page

Project website for **AnyMo: Scaling Any-Modality Conditional Motion Generation with Masked Modeling**.

- Website: https://liyiheng23.github.io/anymo-page/
- Paper: https://arxiv.org/abs/2605.29488
- Dataset: https://huggingface.co/datasets/L-yiheng/OmniHuMo

Static HTML, CSS and JavaScript. Open index.html directly for a local preview. No install or build step is required. GitHub Pages serves the root of the main branch.

Edit index.html for page content, styles.css for presentation, app.js for gallery / figure interactions, and config.js for resource links and optional author-supplied videos. Paper-code links remain hidden until an actual code repository is supplied.

The five figure SVGs are exported from the author-provided original PDF figures. They preserve vector graphics, text outlines and native image detail. Figure sources are recorded in assets/paper/manifest.json.

The website includes the paper teaser, abstract, generation gallery, OmniHuMo dataset description and BibTeX. Method architecture and model-scaling sections are intentionally omitted.

## OmniHuMo interactive visualizations

The dataset section now includes a dependency-free 3D skeleton viewer and an
interactive dataset-size chart. All assets are local; the page still works as
static HTML with no build step, install, CDN, or model download.

- `motion-viewer.js` / `motion-viewer.css`: play/pause, frame scrubbing, playback
  speed, pointer and keyboard orbit, front/side/top views, root path, and pose trails.
  Starts paused; animation is suspended off-screen and in hidden tabs.
- `assets/data/omnihumo-samples.js`: three real OmniHuMo records, sampled from
  30 to 15 FPS. Their original joint rotations and root translations are rendered
  using **approximate canonical skeleton proportions**, without subject shape
  coefficients or an SMPL body mesh. These are dataset observations, not AnyMo
  generations. Recorded captions, source-member hashes, pinned release revision,
  and processing details accompany the data. See [attribution and adaptations](assets/data/NOTICE.md).
- `dataset-stats.js` / `dataset-stats.css`: switch between hours and sequence
  counts for all seven datasets in [AnyMo Table 1](https://arxiv.org/html/2605.29488v1).
  Bar lengths use a shared linear scale starting at zero; the static hours chart
  remains readable without JavaScript. Values are paper-reported, not an inventory
  of the current Hugging Face release.

### Reproduce the sample bundle

Python with NumPy is needed only to regenerate sample assets. The exporter reads
exactly the first 4 MiB of the pinned archive with HTTP Range, checks its SHA256,
reads only three small numeric records through a restricted reader, and exports
22-joint forward kinematics. It does not download the full dataset or SMPL weights.

```sh
python3 scripts/export_omnihumo_samples.py --download --prefix /tmp/omnihumo-prefix.bin
```

The derived sample data remains under **CC BY-NC-SA 4.0**. Captions can mention
objects that are absent from a skeleton-only preview. These three archive records
are illustrative and do not represent the dataset's action distribution.

### Local verification

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/#dataset`. Verify each sample, play/pause and seek,
camera presets and arrow keys, speed selection, root path/trails, and the
Duration/Sequences switch. Also check the existing generation tabs and figure
expansion. New controls include visible focus styles and accessible labels.
