const frameCount = 240;
const defaultFrameBase = "public/frames";
const canvas = document.querySelector("#sequence");
const blendCanvas = document.querySelector("#sequence-blend");
const context = canvas.getContext("2d");
const blendContext = blendCanvas.getContext("2d");
const scrollZones = [...document.querySelectorAll("[data-scroll-zone]")];
const chapterTargets = [...document.querySelectorAll("[data-chapter]")];
const chapterCurrent = document.querySelector(".chapter-current");
const chapterTotal = document.querySelector(".chapter-total");
const chapterLabel = document.querySelector(".chapter-label");
const images = new Map();
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const PX_PER_FRAME = 18;
const BRIDGE_VIEWPORT_RATIO = 0.86;
const SCENE_TEXT_REVEAL_AT = 0.08;
const MOBILE_MQ = window.matchMedia("(max-width: 640px)");
const MOBILE_PX_PER_FRAME_FACTOR = 1.55;
const MOBILE_FRAME_LERP = 0.1;
const DESKTOP_FRAME_LERP = 0.16;
const MOBILE_BRIDGE_VIEWPORT_RATIO = 1.05;
const MOBILE_HOLD_RATIO_FACTOR = 1.35;

function isMobileViewport() {
  return MOBILE_MQ.matches;
}

const BRIDGE_HOLD_END = 0;
const BRIDGE_FADE_TO_BLACK_END = 0.28;
const BRIDGE_TITLE_END = 0.58;
const BRIDGE_FADE_IN_END = 1;

let zones = [];
let currentFrame = 0;
let targetFrame = 0;
let currentFrameBase = defaultFrameBase;
let targetFrameBase = defaultFrameBase;
let blendTarget = 0;
let blendAmount = 0;
let veilAmount = 0;
let sceneOpacity = 1;
let titleOpacity = 0;
let activeBridge = null;
let activeChapterIndex = -1;
const transitionKicker = document.querySelector(".transition-kicker");
const transitionHeading = document.querySelector(".transition-heading");
const transitionTitles = document.querySelector(".transition-titles");

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

function framePath(index, base = defaultFrameBase) {
  return `${base}/frame_${String(index + 1).padStart(6, "0")}.jpg`;
}

function loadFrame(index, base = defaultFrameBase) {
  const key = `${base}:${index}`;
  if (images.has(key)) return images.get(key);

  const image = new Image();
  image.decoding = "async";
  image.src = framePath(index, base);
  images.set(key, image);
  return image;
}

function drawCover(image, ctx = context, targetCanvas = canvas) {
  if (!image || !image.complete || !image.naturalWidth) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(window.innerWidth * dpr);
  const height = Math.floor(window.innerHeight * dpr);

  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }

  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getScrollProgress() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  return maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) : 0;
}

function getActiveZone() {
  if (!zones.length) return null;

  const scrollY = window.scrollY;
  return (
    zones.find((zone) => scrollY >= zone.top && scrollY < zone.bottom) ??
    (scrollY < zones[0].top ? zones[0] : zones[zones.length - 1])
  );
}

function getZoneLocal(zone) {
  if (!zone) return 0;

  return clamp((window.scrollY - zone.top) / (zone.bottom - zone.top), 0, 1);
}

function warmNearby(index, base = defaultFrameBase, count = frameCount) {
  for (let offset = 1; offset <= 8; offset += 1) {
    if (index + offset < count) loadFrame(index + offset, base);
    if (index - offset >= 0) loadFrame(index - offset, base);
  }
}

function buildZones() {
  let offsetTop = 0;

  zones = scrollZones.map((element) => {
    const type = element.dataset.scrollZone;
    let height = 0;
    const zone = { element, type, top: offsetTop };

    if (type === "scene") {
      const base = element.dataset.frameBase || defaultFrameBase;
      const start = Number(element.dataset.frameStart);
      const end = Number(element.dataset.frameEnd);
      const length = end - start + 1;
      const pxPerFrame =
        Number(element.dataset.pxPerFrame ?? PX_PER_FRAME) *
        (isMobileViewport() ? MOBILE_PX_PER_FRAME_FACTOR : 1);
      const panelCount = element.querySelectorAll(".panel").length || 1;
      const contentHeight = panelCount * window.innerHeight;
      const frameHeight = length * pxPerFrame;
      height = Math.max(contentHeight, frameHeight);
      zone.frameStart = start;
      zone.frameEnd = end;
      zone.frameLength = length;
      zone.pxPerFrame = pxPerFrame;
      zone.frameBase = base;
      zone.frameCount = Number(element.dataset.frameCount ?? (end + 1));

      if (panelCount === 1) {
        const panel = element.querySelector(".panel");
        if (panel) panel.style.minHeight = `${height}px`;
      }
    } else if (type === "bridge") {
      const bridgeRatio = isMobileViewport() ? MOBILE_BRIDGE_VIEWPORT_RATIO : BRIDGE_VIEWPORT_RATIO;
      height = Math.round(window.innerHeight * bridgeRatio);
      zone.holdFrame = Number(element.dataset.holdFrame);
      zone.holdBase = element.dataset.holdBase || defaultFrameBase;
      zone.nextFrame = Number(element.dataset.nextFrame);
      zone.nextBase = element.dataset.nextBase || defaultFrameBase;
      zone.nextKicker = element.dataset.nextKicker || "";
      zone.nextTitle = element.dataset.nextTitle || "";
      zone.fadeToBlackEnd = numberOption(element.dataset.fadeToBlackEnd, BRIDGE_FADE_TO_BLACK_END);
      zone.titleEnd = numberOption(element.dataset.titleEnd, BRIDGE_TITLE_END);
      zone.fadeInEnd = numberOption(element.dataset.fadeInEnd, BRIDGE_FADE_IN_END);
    } else if (type === "hold") {
      const holdRatio = Number(element.dataset.holdRatio ?? 1.18);
      const mobileHoldFactor = isMobileViewport() ? MOBILE_HOLD_RATIO_FACTOR : 1;
      height = Math.round(window.innerHeight * holdRatio * mobileHoldFactor);
      zone.frameBase = element.dataset.frameBase || defaultFrameBase;
      zone.holdFrame = Number(element.dataset.holdFrame ?? frameCount - 1);
      zone.loopStart = Number(element.dataset.loopStart ?? 0);
      zone.loopEnd = Number(element.dataset.loopEnd ?? 59);
      zone.frameCount = Number(element.dataset.frameCount ?? frameCount);
    }

    zone.bottom = offsetTop + height;
    element.style.minHeight = `${height}px`;
    offsetTop = zone.bottom;

    return zone;
  });

  document.body.style.minHeight = `${offsetTop}px`;
}

function getBridgeTransition(local, zone) {
  const peakVeil = 1;
  const fadeToBlackEnd = clamp(zone?.fadeToBlackEnd ?? BRIDGE_FADE_TO_BLACK_END, 0.01, 0.98);
  const titleEnd = clamp(zone?.titleEnd ?? BRIDGE_TITLE_END, fadeToBlackEnd + 0.01, 0.99);
  const fadeInEnd = clamp(zone?.fadeInEnd ?? BRIDGE_FADE_IN_END, titleEnd + 0.01, 1);

  if (local < BRIDGE_HOLD_END) {
    return {
      frame: "hold",
      veil: 0,
      sceneOpacity: 1,
      title: 0
    };
  }

  if (local < fadeToBlackEnd) {
    const t = easeInOutCubic(
      (local - BRIDGE_HOLD_END) / (fadeToBlackEnd - BRIDGE_HOLD_END)
    );
    return {
      frame: "hold",
      veil: lerp(0, peakVeil, t),
      sceneOpacity: lerp(1, 0, t),
      title: 0
    };
  }

  if (local < titleEnd) {
    return {
      frame: "next",
      veil: peakVeil,
      sceneOpacity: 0,
      title: 1
    };
  }

  if (local < fadeInEnd) {
    const t = easeInOutCubic(
      (local - titleEnd) / (fadeInEnd - titleEnd)
    );
    return {
      frame: "next",
      veil: lerp(peakVeil, 0, t),
      sceneOpacity: lerp(0, 1, t),
      title: lerp(1, 0, t)
    };
  }

  return {
    frame: "next",
    veil: 0,
    sceneOpacity: 1,
    title: 0
  };
}

function getSceneFrame(local, zone) {
  const delay = Number(zone.element.dataset.frameDelay ?? 0);
  const holdTail = Number(zone.element.dataset.frameHoldTail ?? 0);
  const available = Math.max(0.01, 1 - delay);
  const delayedLocal = clamp((local - delay) / available, 0, 1);
  const animPortion = holdTail > 0 ? 1 - holdTail : 1;
  const animLocal = animPortion >= 1 ? delayedLocal : clamp(delayedLocal / animPortion, 0, 1);
  const eased = easeInOutCubic(animLocal);
  const frame = lerp(zone.frameStart, zone.frameEnd, eased);
  return clamp(Math.round(frame), zone.frameStart, zone.frameEnd);
}

function getFrameState() {
  const lastFrame = frameCount - 1;

  if (!zones.length) {
    const linear = getScrollProgress();
    const frame = Math.round(linear * lastFrame);
    return {
      frameA: frame,
      frameBase: defaultFrameBase,
      frameB: frame,
      blend: 0,
      veil: 0,
      sceneOpacity: 1,
      title: 0,
      bridge: null
    };
  }

  const active = getActiveZone();
  const local = getZoneLocal(active);

  if (active.type === "scene") {
    const rounded = getSceneFrame(local, active);
    return {
      frameA: rounded,
      frameBase: active.frameBase || defaultFrameBase,
      frameCount: active.frameCount || frameCount,
      frameB: rounded,
      blend: 0,
      veil: 0,
      sceneOpacity: 1,
      title: 0,
      bridge: null
    };
  }

  if (active.type === "bridge") {
    const transition = getBridgeTransition(local, active);
    const displayFrame =
      transition.frame === "next" ? active.nextFrame : active.holdFrame;
    const displayBase =
      transition.frame === "next"
        ? active.nextBase || defaultFrameBase
        : active.holdBase || defaultFrameBase;

    return {
      frameA: displayFrame,
      frameBase: displayBase,
      frameCount: frameCount,
      frameB: displayFrame,
      blend: 0,
      veil: transition.veil,
      sceneOpacity: transition.sceneOpacity,
      title: transition.title,
      bridge: active,
      snapFrame: true
    };
  }

  const holdFrame = active.holdFrame ?? lastFrame;
  const displayFrame =
    active.type === "hold" && active.holdFrame === 0
      ? Math.round(lerp(active.loopStart ?? 0, active.loopEnd ?? 59, getZoneLocal(active)))
      : holdFrame;
  return {
    frameA: displayFrame,
    frameBase: active.frameBase || defaultFrameBase,
    frameCount: active.frameCount || frameCount,
    frameB: displayFrame,
    blend: 0,
    veil: 0,
    sceneOpacity: 1,
    title: 0,
    bridge: null,
    snapFrame: active.type !== "hold" || active.holdFrame !== 0
  };
}

function updateTargetFromScroll() {
  const state = getFrameState();
  targetFrame = state.frameA;
  targetFrameBase = state.frameBase || defaultFrameBase;
  blendTarget = state.frameB;
  blendAmount = state.blend;
  veilAmount = state.veil ?? 0;
  sceneOpacity = state.sceneOpacity ?? 1;
  titleOpacity = state.title ?? 0;

  if (state.snapFrame) {
    currentFrame = targetFrame;
    currentFrameBase = targetFrameBase;
    renderFrames(targetFrame, targetFrameBase);
  }

  const bridge = state.bridge;
  if (bridge && bridge !== activeBridge) {
    activeBridge = bridge;
    const kicker = bridge.nextKicker || "";
    if (transitionKicker) {
      transitionKicker.textContent = kicker;
      transitionKicker.hidden = !kicker;
    }
    if (transitionHeading) transitionHeading.textContent = bridge.nextTitle || "";
  } else if (!bridge) {
    activeBridge = null;
  }
}

function updatePanelVisibility(active) {
  if (!active || active.type === "bridge") {
    chapterTargets.forEach((target) => target.classList.remove("is-visible"));
    return;
  }

  const readableTop = window.innerHeight * 0.16;
  const readableBottom = window.innerHeight * 0.84;
  const local = getZoneLocal(active);
  const activeIndex = zones.indexOf(active);
  const isFirstScene = activeIndex === 0;
  const canRevealText = active.type === "hold" || isFirstScene || local >= SCENE_TEXT_REVEAL_AT;

  chapterTargets.forEach((target) => {
    const host = target.closest("[data-scroll-zone]");
    const rect = target.getBoundingClientRect();
    const isInActiveZone = host === active.element;
    const isReadable = rect.top < readableBottom && rect.bottom > readableTop;

    target.classList.toggle("is-visible", isInActiveZone && isReadable && canRevealText);
  });
}

function updateChapter(active) {
  if (!active || active.type === "bridge") return;

  const activeIndex = zones.indexOf(active);
  const isFirstScene = activeIndex === 0;
  if (active.type === "scene" && !isFirstScene && getZoneLocal(active) < SCENE_TEXT_REVEAL_AT) {
    return;
  }

  const targetsInActiveZone = chapterTargets.filter(
    (target) => target.closest("[data-scroll-zone]") === active.element
  );
  const candidates = targetsInActiveZone.length ? targetsInActiveZone : chapterTargets;
  const viewportCenter = window.innerHeight * 0.5;
  let nextIndex = 0;
  let smallestDistance = Infinity;

  candidates.forEach((target) => {
    const rect = target.getBoundingClientRect();
    const center = rect.top + rect.height * 0.5;
    const distance = Math.abs(center - viewportCenter);

    if (distance < smallestDistance) {
      smallestDistance = distance;
      nextIndex = chapterTargets.indexOf(target);
    }
  });

  if (nextIndex === activeChapterIndex) return;

  activeChapterIndex = nextIndex;
  const current = chapterTargets[nextIndex];

  chapterCurrent.textContent = current.dataset.chapter || String(nextIndex + 1).padStart(2, "0");
  chapterLabel.textContent = current.dataset.title || "";
  chapterTotal.textContent = String(chapterTargets.length).padStart(2, "0");
  document.body.dataset.activeChapter = current.dataset.chapter || String(nextIndex + 1);
}

function updateDepth() {
  document.documentElement.style.setProperty("--scroll-progress", getScrollProgress().toFixed(4));
}

function updateActiveZone() {
  const active = getActiveZone();
  if (!active) return null;

  document.body.dataset.activeZone = active.type || "";
  document.documentElement.style.setProperty("--transition-veil", veilAmount.toFixed(4));
  document.documentElement.style.setProperty("--scene-opacity", sceneOpacity.toFixed(4));
  document.documentElement.style.setProperty("--title-opacity", titleOpacity.toFixed(4));
  document.documentElement.style.setProperty(
    "--chrome-opacity",
    Math.max(0, 1 - Math.max(veilAmount, titleOpacity)).toFixed(4)
  );
  if (transitionTitles) {
    transitionTitles.style.opacity = titleOpacity.toFixed(4);
  }

  return active;
}

function preloadKeyFrames() {
  [0, 55, 60, 116, 119, 178, 181, 239].forEach((index) => loadFrame(index));
  [0, 24, 48, 72, 96, 120, 144, 168, 192, 216].forEach((index) => loadFrame(index));
  [0, 12, 24, 36, 48, 60, 73].forEach((index) => loadFrame(index, "public/frames/childcare"));

  for (let index = 0; index < Math.min(22, frameCount); index += 1) {
    loadFrame(index);
  }
}

function preloadRest() {
  const run = () => {
    let index = 22;
    const chunk = () => {
      const limit = Math.min(index + 10, frameCount);

      for (; index < limit; index += 1) {
        loadFrame(index);
      }

      if (index < frameCount) {
        window.setTimeout(chunk, 80);
      }
    };

    chunk();
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 2200 });
  } else {
    window.setTimeout(run, 1200);
  }
}

function observePanels() {
  chapterTargets.forEach((target) => target.classList.remove("is-visible"));
}

function renderFrames(frameA, base = defaultFrameBase) {
  drawCover(loadFrame(frameA, base), context, canvas);
  blendCanvas.style.opacity = "0";
}

function tick() {
  if (currentFrameBase !== targetFrameBase) {
    currentFrameBase = targetFrameBase;
    currentFrame = targetFrame;
  }

  const delta = targetFrame - currentFrame;
  const frameLerp = isMobileViewport() ? MOBILE_FRAME_LERP : DESKTOP_FRAME_LERP;
  currentFrame += prefersReducedMotion ? delta : delta * frameLerp;

  if (Math.abs(delta) < 0.08) {
    currentFrame = targetFrame;
  }

  const active = getActiveZone();
  const activeFrameCount = active?.frameBase === currentFrameBase ? active.frameCount || frameCount : frameCount;
  const frameIndex = clamp(Math.round(currentFrame), 0, activeFrameCount - 1);
  renderFrames(frameIndex, currentFrameBase);
  warmNearby(frameIndex, currentFrameBase, activeFrameCount);
  requestAnimationFrame(tick);
}

function handleScroll() {
  updateTargetFromScroll();
  updateDepth();
  const active = updateActiveZone();
  updatePanelVisibility(active);
  updateChapter(active);
}

function handleResize() {
  buildZones();
  handleScroll();
  renderFrames(clamp(Math.round(currentFrame), 0, frameCount - 1), currentFrameBase);
}

window.addEventListener("scroll", handleScroll, { passive: true });
window.addEventListener("resize", handleResize);
MOBILE_MQ.addEventListener("change", handleResize);

window.addEventListener("pageshow", () => {
  if (location.hash) return;

  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    handleResize();
  });
});

loadFrame(0).addEventListener("load", () => renderFrames(0), { once: true });
buildZones();
preloadKeyFrames();
preloadRest();
observePanels();
handleScroll();
tick();
