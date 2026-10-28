/* OmniHuMo motion explorer. Real joint samples are supplied by assets/data/omnihumo-samples.js.
   Canvas projection is deliberately dependency-free; no model is run in-browser. */
(() => {
  "use strict";
  const root = document.getElementById("motion-explorer");
  if (!root) return;
  const find = name => root.querySelector(`[data-motion-${name}]`);
  const canvas = find("canvas");
  const status = find("status");
  const data = window.OMNIHUMO_SAMPLES;
  const jointNames = data?.jointNames || [];
  const isPoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  // Reject incomplete samples rather than drawing an invented or misleading pose.
  const samples = (Array.isArray(data?.samples) ? data.samples : []).filter(sample =>
    sample && Number.isFinite(sample.fps) && sample.fps > 0 &&
    Array.isArray(sample.frames) && sample.frames.length > 0 &&
    sample.frames.every(frame => Array.isArray(frame) && frame.length === jointNames.length &&
      frame.length > 1 && frame.every(isPoint)));
  const bones = (Array.isArray(data?.bones) ? data.bones : []).filter(bone =>
    Array.isArray(bone) && bone.length === 2 && bone.every(n =>
      Number.isInteger(n) && n >= 0 && n < jointNames.length));
  const ctx = canvas?.getContext?.("2d");
  if (!ctx || !samples.length || !bones.length) {
    if (status) status.textContent = "The interactive preview is unavailable. Browse the original OmniHuMo dataset below.";
    const loading = find("loading");
    if (loading) loading.textContent = "Motion preview unavailable. The source dataset is linked below.";
    return;
  }

  const select = find("select");
  const play = find("play");
  const scrub = find("scrub");
  const speed = find("speed");
  const trajectory = find("trajectory");
  const trails = find("trails");
  const readout = find("readout");
  const views = Array.from(root.querySelectorAll("[data-motion-view]"));
  const sampleButtons = [];
  let sample, frameIndex = 0, requestedPlay = false, inView = true, raf = 0, previousTime = null;
  let accumulated = 0, width = 0, height = 0, center = [0, 0, 0], radius = 1, floor = 0;
  const defaultView = { yaw: -0.55, pitch: 0.24 };
  let yaw = defaultView.yaw, pitch = defaultView.pitch, drag = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rootJoint = Math.max(0, jointNames.findIndex(name => /^(pelvis|root|hips)$/i.test(name)));
  const formatTime = seconds => `${seconds.toFixed(2)} s`;

  samples.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = item.label || item.title || `Sample ${String(index + 1).padStart(2, "0")}`;
    select.appendChild(option);
  });
  root.querySelectorAll("button, select, input").forEach(control => { control.disabled = false; });
  root.classList.add("motion-ready");
  find("loading").hidden = true;

  function fitSample() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const frame of sample.frames) for (const point of frame) {
      point.forEach((value, axis) => {
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      });
    }
    center = min.map((value, axis) => (value + max[axis]) / 2);
    floor = min[1];
    radius = Math.max(0.35, Math.hypot(...max.map((value, axis) => (value - min[axis]) / 2)));
  }

  // Perspective camera around the clip bounds; Y remains the vertical axis.
  function project(point) {
    const dx = point[0] - center[0], dy = point[1] - center[1], dz = point[2] - center[2];
    const x = Math.cos(yaw) * dx + Math.sin(yaw) * dz;
    const z = -Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    const y = Math.cos(pitch) * dy - Math.sin(pitch) * z;
    const depth = Math.sin(pitch) * dy + Math.cos(pitch) * z;
    const distance = radius * 6;
    const scale = Math.min(width / (radius * 2.65), height / (radius * 2.65));
    const perspective = distance / (distance - depth);
    return [width / 2 + x * scale * perspective, height * 0.48 - y * scale * perspective, depth];
  }

  function line(a, b, color, lineWidth = 1) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  }

  function drawGrid() {
    const extent = Math.max(1.25, radius * 1.25);
    const spacing = extent > 3 ? 1 : 0.5;
    const count = Math.ceil(extent / spacing);
    for (let n = -count; n <= count; n++) {
      const offset = n * spacing;
      const color = n === 0 ? "#d7e4ee" : "#e7eef4";
      line(project([center[0] + offset, floor, center[2] - extent]),
        project([center[0] + offset, floor, center[2] + extent]), color);
      line(project([center[0] - extent, floor, center[2] + offset]),
        project([center[0] + extent, floor, center[2] + offset]), color);
    }
  }

  function jointColor(index) {
    const name = String(jointNames[index]).toLowerCase();
    if (name.startsWith("left") || /^l[_-]/.test(name)) return "#397bb8";
    if (name.startsWith("right") || /^r[_-]/.test(name)) return "#df9460";
    return "#4c6175";
  }

  // Each thumbnail is one actual midpoint frame, independently fitted for legibility.
  // Thumbnails are rendered once and never run their own animation loop.
  function drawThumbnail(thumbnail, item) {
    const context = thumbnail.getContext("2d");
    if (!context) return;
    const w = 90, h = 104, dpr = Math.min(window.devicePixelRatio || 1, 2);
    thumbnail.width = Math.round(w * dpr); thumbnail.height = Math.round(h * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const frame = item.frames[Math.floor((item.frames.length - 1) / 2)];
    const rotated = frame.map(([x, y, z]) => {
      const dx = Math.cos(defaultView.yaw) * x + Math.sin(defaultView.yaw) * z;
      const dz = -Math.sin(defaultView.yaw) * x + Math.cos(defaultView.yaw) * z;
      return [dx, Math.cos(defaultView.pitch) * y - Math.sin(defaultView.pitch) * dz,
        Math.sin(defaultView.pitch) * y + Math.cos(defaultView.pitch) * dz];
    });
    const minX = Math.min(...rotated.map(p => p[0])), maxX = Math.max(...rotated.map(p => p[0]));
    const minY = Math.min(...rotated.map(p => p[1])), maxY = Math.max(...rotated.map(p => p[1]));
    const scale = Math.min((w - 22) / Math.max(maxX - minX, 0.3), (h - 24) / Math.max(maxY - minY, 0.3));
    const points = rotated.map(([x, y, z]) => [w / 2 + (x - (minX + maxX) / 2) * scale,
      h / 2 - (y - (minY + maxY) / 2) * scale, z]);
    context.lineCap = "round"; context.lineJoin = "round";
    [...bones].sort((a, b) => (points[a[0]][2] + points[a[1]][2]) - (points[b[0]][2] + points[b[1]][2]))
      .forEach(([a, b]) => {
        context.beginPath(); context.moveTo(points[a][0], points[a][1]); context.lineTo(points[b][0], points[b][1]);
        context.strokeStyle = jointColor(b); context.lineWidth = 2.3; context.stroke();
      });
    points.forEach((point, index) => {
      context.beginPath(); context.arc(point[0], point[1], 1.8, 0, Math.PI * 2);
      context.fillStyle = jointColor(index); context.fill();
    });
  }

  function buildSampleBrowser() {
    const browser = document.createElement("div"); browser.className = "motion-browser";
    const heading = document.createElement("div"); heading.className = "motion-browser-heading";
    const title = document.createElement("h4"); title.id = "motion-browser-heading";
    title.textContent = "Browse motion samples";
    const count = document.createElement("span"); count.textContent = `${samples.length} recordings`;
    heading.append(title, count);
    const hint = document.createElement("p"); hint.className = "motion-browser-hint";
    hint.textContent = "Mid-sequence poses from the dataset. Select a sample to explore its full motion above.";
    const grid = document.createElement("div"); grid.className = "motion-sample-grid";
    grid.setAttribute("role", "group"); grid.setAttribute("aria-labelledby", title.id);
    samples.forEach((item, index) => {
      const label = item.label || item.title || `Sample ${index + 1}`;
      const button = document.createElement("button"); button.type = "button"; button.className = "motion-sample-card";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `View sample ${index + 1}: ${label}`);
      const thumbnail = document.createElement("canvas"); thumbnail.className = "motion-sample-thumbnail";
      thumbnail.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span"); copy.className = "motion-sample-copy";
      const number = document.createElement("span"); number.className = "motion-sample-index";
      number.textContent = `SAMPLE ${String(index + 1).padStart(2, "0")}`;
      const name = document.createElement("span"); name.className = "motion-sample-name"; name.textContent = label;
      const duration = document.createElement("span"); duration.className = "motion-sample-span";
      duration.textContent = `${formatTime((item.frames.length - 1) / item.fps)} preview`;
      copy.append(number, name, duration); button.append(thumbnail, copy); grid.appendChild(button);
      button.addEventListener("click", () => {
        chooseSample(index);
        root.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
      });
      sampleButtons.push(button);
      drawThumbnail(thumbnail, item);
    });
    browser.append(heading, hint, grid); root.appendChild(browser);
  }

  function drawPose(frame, opacity) {
    const points = frame.map(project);
    ctx.globalAlpha = opacity;
    // Depth sorting helps an orbit make the front/back limbs understandable.
    [...bones].sort((a, b) =>
      (points[a[0]][2] + points[a[1]][2]) - (points[b[0]][2] + points[b[1]][2]))
      .forEach(([a, b]) => line(points[a], points[b], jointColor(b), opacity < 1 ? 2 : 4));
    if (opacity === 1) {
      [...points.keys()].sort((a, b) => points[a][2] - points[b][2]).forEach(index => {
        const point = points[index];
        ctx.beginPath(); ctx.arc(point[0], point[1], index === rootJoint ? 5 : 3.3, 0, Math.PI * 2);
        ctx.fillStyle = jointColor(index); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    if (!sample || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    drawGrid();
    if (trajectory.checked) {
      ctx.beginPath();
      sample.frames.forEach((frame, index) => {
        const rootPoint = frame[rootJoint];
        const p = project([rootPoint[0], floor + 0.005, rootPoint[2]]);
        if (index === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      });
      ctx.lineWidth = 2; ctx.strokeStyle = "#759bb7"; ctx.setLineDash([4, 5]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (trails.checked) {
      const step = Math.max(1, Math.round(sample.fps * 0.3));
      for (let ghost = 3; ghost >= 1; ghost--) {
        const index = frameIndex - ghost * step;
        if (index >= 0) drawPose(sample.frames[index], 0.08 + (3 - ghost) * 0.08);
      }
    }
    drawPose(sample.frames[frameIndex], 1);
  }

  function updateFrame() {
    scrub.value = String(frameIndex);
    const time = frameIndex / sample.fps;
    readout.textContent = `${formatTime(time)} / ${formatTime((sample.frames.length - 1) / sample.fps)} · Frame ${frameIndex + 1} / ${sample.frames.length}`;
    scrub.setAttribute("aria-valuetext", `${formatTime(time)}, frame ${frameIndex + 1} of ${sample.frames.length}`);
    render();
  }

  // A requested playback pauses its clock while off-screen or in a hidden tab.
  // The user's Play/Pause choice is preserved; hidden time never advances frames.
  function canAnimate() { return requestedPlay && inView && !document.hidden; }
  function syncAnimation() {
    play.textContent = requestedPlay ? "Pause" : "Play motion";
    play.setAttribute("aria-pressed", String(requestedPlay));
    play.setAttribute("aria-label", requestedPlay ? "Pause motion playback" : "Play motion playback");
    status.textContent = requestedPlay ? (canAnimate() ? "Playing" : "Playback suspended while out of view") : "Paused · drag to rotate";
    if (!canAnimate()) {
      cancelAnimationFrame(raf); raf = 0; previousTime = null;
    } else if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick(time) {
    raf = 0;
    if (!canAnimate()) { previousTime = null; return; }
    if (previousTime !== null) accumulated += Math.min(time - previousTime, 100) * Number(speed.value) / 1000;
    previousTime = time;
    const step = 1 / sample.fps;
    const frames = Math.floor(accumulated / step);
    if (frames) {
      accumulated -= frames * step;
      frameIndex = (frameIndex + frames) % sample.frames.length;
      updateFrame();
    }
    raf = requestAnimationFrame(tick);
  }

  function chooseSample(index) {
    requestedPlay = false; accumulated = 0; previousTime = null;
    sample = samples[index]; frameIndex = 0;
    select.value = String(index);
    sampleButtons.forEach((button, buttonIndex) => button.setAttribute("aria-pressed", String(buttonIndex === index)));
    scrub.max = String(sample.frames.length - 1);
    find("caption").textContent = sample.caption || "No text annotation is included with this sample.";
    find("id").textContent = sample.id;
    find("duration").textContent = formatTime((sample.frames.length - 1) / sample.fps);
    find("fps").textContent = `${sample.fps} FPS`;
    find("joints").textContent = `${jointNames.length} body joints`;
    find("sample-number").textContent = `${String(index + 1).padStart(2, "0")} / ${String(samples.length).padStart(2, "0")}`;
    fitSample(); updateFrame(); syncAnimation();
    status.textContent = `${sample.title || sample.label || `Sample ${index + 1}`} selected · paused`;
  }

  function setView(name) {
    const preset = { front: [0, 0], side: [Math.PI / 2, 0], top: [0, Math.PI / 2 - 0.001], reset: [defaultView.yaw, defaultView.pitch] }[name];
    if (!preset) return;
    [yaw, pitch] = preset;
    views.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.motionView === name && name !== "reset")));
    render();
  }
  function orbit(dx, dy) {
    yaw += dx; pitch = Math.max(-1.25, Math.min(Math.PI / 2 - 0.001, pitch + dy));
    views.forEach(button => button.setAttribute("aria-pressed", "false"));
    render();
  }
  select.addEventListener("change", () => chooseSample(Number(select.value)));
  play.addEventListener("click", () => { requestedPlay = !requestedPlay; syncAnimation(); });
  scrub.addEventListener("input", () => {
    frameIndex = Number(scrub.value); accumulated = 0; previousTime = null; updateFrame();
  });
  speed.addEventListener("change", () => { accumulated = 0; previousTime = null; });
  trajectory.addEventListener("change", render); trails.addEventListener("change", render);
  views.forEach(button => button.addEventListener("click", () => setView(button.dataset.motionView)));
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    orbit((event.clientX - drag.x) * 0.008, (event.clientY - drag.y) * 0.006);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  const endDrag = () => { drag = null; canvas.classList.remove("is-dragging"); };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);
  canvas.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") orbit(-0.12, 0);
    if (event.key === "ArrowRight") orbit(0.12, 0);
    if (event.key === "ArrowUp") orbit(0, 0.08);
    if (event.key === "ArrowDown") orbit(0, -0.08);
    if (event.key === "Home") setView("reset");
  });

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width; height = bounds.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); render();
  }
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting; syncAnimation();
    }, { threshold: 0 }).observe(canvas);
  }
  document.addEventListener("visibilitychange", syncAnimation);
  // Playback is always opt-in. Enabling reduced motion also stops an active clip.
  reducedMotion.addEventListener?.("change", event => {
    if (event.matches) { requestedPlay = false; syncAnimation(); }
  });
  buildSampleBrowser(); chooseSample(0); resize();
})();
