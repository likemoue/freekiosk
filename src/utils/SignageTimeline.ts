/**
 * Playing a playlist in step on every screen.
 *
 * No screen tells another anything. Each one works out from the same clock which item plays now and how
 * far into it: the time since the playlist began, against the length of every item. Two screens that
 * agree on the time and on the lengths show the same frame, whenever each of them started, restarted
 * or came back online. Hence the cloud gives both: `sync_epoch_ms`, and `duration_ms` for its videos.
 *
 * This is written as text because it runs inside the player's page (MediaPlayerComponent), and
 * as plain ES5 for the older WebViews. The tests compile the first part and run it as it is.
 */

/** Which item plays at a moment, from nothing but the lengths. No state, so that it can be tested alone */
export const SIGNAGE_TIMELINE_JS = `
  function buildTimeline(lengthsMs) {
    var starts = [];
    var total = 0;
    for (var i = 0; i < lengthsMs.length; i++) {
      starts.push(total);
      total += lengthsMs[i];
    }
    return { starts: starts, lengths: lengthsMs, total: total };
  }

  function locateInTimeline(timeline, elapsedMs) {
    if (elapsedMs < 0) {
      return { index: 0, intoMs: 0, untilNextMs: timeline.lengths[0], cycle: 0, waiting: true };
    }
    var cycle = Math.floor(elapsedMs / timeline.total);
    var position = elapsedMs - cycle * timeline.total;
    var index = timeline.starts.length - 1;
    for (var i = 0; i < timeline.starts.length; i++) {
      if (position < timeline.starts[i] + timeline.lengths[i]) {
        index = i;
        break;
      }
    }
    var into = position - timeline.starts[index];
    return { index: index, intoMs: into, untilNextMs: timeline.lengths[index] - into, cycle: cycle, waiting: false };
  }

  function nextInTimeline(timeline, at) {
    var index = at.index + 1;
    var cycle = at.cycle;
    if (index >= timeline.starts.length) {
      index = 0;
      cycle += 1;
    }
    return { index: index, cycle: cycle };
  }

  // A small gap is closed by playing faster or slower, which nobody sees for the second it lasts. A big
  // one takes a seek. In steps of 5%, since each change of speed costs the player something.
  function correctionFor(gapSeconds) {
    var size = Math.abs(gapSeconds);
    if (size > 0.6) return { seek: true, rate: 1 };
    if (size > 0.04) return { seek: false, rate: Math.round((1 - Math.max(-0.25, Math.min(0.25, gapSeconds))) * 20) / 20 };
    return { seek: false, rate: 1 };
  }
`;

/**
 * The player itself. Uses what the page around it defines: playlist, SETTINGS, SYNC, the two slots and
 * their helpers. Falls back to `fallback`, the usual one item after the other, when a length cannot be
 * known: a YouTube video with no duration set, or a video that does not say how long it is.
 */
export const IN_STEP_PLAYER_JS = `
  var stepActive = false;
  var stepTimeline = null;
  var stepCurrent = null;
  var stepPrepared = null;
  var stepCleanup = null;
  var stepBoundary = null;
  var stepLastSeek = 0;
  var STEP_TICK_MS = 200;
  var STEP_PREPARE_MS = 5000;
  var STEP_SEEK_GAP_MS = 2500;
  var STEP_SEEK_LEAD_S = 0.15;
  var STEP_RETRY_MS = 5000;
  // How long before its turn each video has to be told to play: a video takes time to begin, which
  // differs by tablet and by what played before it, so each screen finds out for itself
  var stepLeadMs = {};
  var STEP_LEAD_MAX_MS = 800;

  function stepBuild(index, key, intoSeconds) {
    var item = playlist[index];
    if (stepCleanup) { clearTimeout(stepCleanup); stepCleanup = null; }
    var slot = getInactiveSlot();
    slot.innerHTML = '';
    var entry = { key: key, index: index, kind: item.type, el: null, ready: false, due: false, shown: false, failedAt: 0, fromStart: intoSeconds === 0, measured: false, early: false };
    function whenReady() {
      entry.ready = true;
      if (entry.due) stepReveal(entry);
    }
    function failed() { entry.failedAt = Date.now(); }
    if (item.type === 'video') {
      var video = document.createElement('video');
      video.src = item.url;
      video.muted = SETTINGS.muteVideo;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'auto';
      if (intoSeconds > 0) {
        video.addEventListener('loadedmetadata', function onMetadata() {
          video.removeEventListener('loadedmetadata', onMetadata);
          try { video.currentTime = intoSeconds; } catch (e) {}
        });
      }
      video.addEventListener('loadeddata', whenReady);
      video.addEventListener('error', failed);
      entry.el = video;
    } else if (item.type === 'web' || item.type === 'youtube') {
      if (isOffline()) { failed(); return entry; }
      var src = item.url;
      if (item.type === 'youtube') src += (src.indexOf('?') >= 0 ? '&' : '?') + 'mute=' + (SETTINGS.muteVideo ? '1' : '0');
      var frame = makeFrame(src);
      if (item.type === 'youtube') {
        frame.setAttribute('allow', 'autoplay; encrypted-media');
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      } else {
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      }
      frame.addEventListener('load', whenReady);
      entry.el = frame;
    } else {
      var img = document.createElement('img');
      img.src = item.url;
      img.draggable = false;
      img.addEventListener('load', whenReady);
      img.addEventListener('error', failed);
      entry.el = img;
    }
    slot.appendChild(entry.el);
    return entry;
  }

  function stepReveal(entry) {
    if (entry.shown || stepCurrent !== entry) return;
    entry.shown = true;
    hideLoading();
    var old = getActiveSlot();
    getInactiveSlot().classList.add('active');
    old.classList.remove('active');
    activeSlot = activeSlot === 'A' ? 'B' : 'A';
    var oldVideo = old.querySelector('video');
    if (oldVideo) oldVideo.pause();
    stepCleanup = setTimeout(function() {
      old.innerHTML = '';
      stepCleanup = null;
    }, SETTINGS.transitionEnabled ? SETTINGS.transitionDuration + 100 : 50);
  }

  function stepPlay(video) {
    var playing = video.play();
    if (playing && playing.catch) playing.catch(function() {});
  }

  function stepLearn(entry, video, at) {
    if (!entry.fromStart || entry.measured || video.paused || !(video.currentTime > 0)) return;
    entry.measured = true;
    var lateMs = at.intoMs - video.currentTime * 1000;
    var leadMs = Math.max(0, Math.min(STEP_LEAD_MAX_MS, (stepLeadMs[entry.index] || 0) + lateMs * 0.7));
    stepLeadMs[entry.index] = leadMs;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'inStep', index: entry.index, lateMs: Math.round(lateMs), leadMs: Math.round(leadMs) }));
    }
  }

  function stepStartEarly(entry, at) {
    if (at.waiting || !entry || entry.kind !== 'video' || entry.early) return;
    var leadMs = stepLeadMs[entry.index] || 0;
    if (!(leadMs > 0) || at.untilNextMs > leadMs + STEP_TICK_MS) return;
    entry.early = true;
    setTimeout(function() {
      if (entry === stepPrepared || entry === stepCurrent) stepPlay(entry.el);
    }, Math.max(0, at.untilNextMs - leadMs));
  }

  function stepCorrect(at) {
    var entry = stepCurrent;
    if (!entry || entry.kind !== 'video' || !entry.el) return;
    var video = entry.el;
    if (at.waiting) {
      if (!video.paused) video.pause();
      return;
    }
    if (video.readyState < 1 || video.seeking) return;
    var want = at.intoMs / 1000;
    var length = isFinite(video.duration) ? video.duration : Infinity;
    // The file is shorter than its turn: the last frame stays until the next item
    if (want >= length) {
      if (!video.paused) video.pause();
      return;
    }
    if (video.paused || video.ended) stepPlay(video);
    stepLearn(entry, video, at);
    var correction = correctionFor(video.currentTime - want);
    if (correction.seek) {
      var now = Date.now();
      if (now - stepLastSeek > STEP_SEEK_GAP_MS) {
        stepLastSeek = now;
        video.playbackRate = 1;
        video.currentTime = Math.min(want + STEP_SEEK_LEAD_S, Math.max(0, length - 0.05));
      }
    } else if (Math.abs(video.playbackRate - correction.rate) > 0.005) {
      video.playbackRate = correction.rate;
    }
  }

  function stepTick() {
    var at = locateInTimeline(stepTimeline, Date.now() + SYNC.offsetMs - SYNC.epochMs);
    var key = at.cycle + ':' + at.index;
    if (stepCurrent && stepCurrent.key === key && stepCurrent.failedAt && Date.now() - stepCurrent.failedAt > STEP_RETRY_MS) {
      // A file that would not load, a network that came back: another try while its turn lasts
      stepCurrent = null;
    }
    if (!stepCurrent || stepCurrent.key !== key) {
      var entry = stepPrepared && stepPrepared.key === key ? stepPrepared : stepBuild(at.index, key, at.intoMs / 1000);
      stepPrepared = null;
      stepCurrent = entry;
      entry.due = true;
      if (entry.ready) stepReveal(entry);
    }
    stepCorrect(at);
    if (!at.waiting && !stepPrepared && stepCurrent.shown && at.untilNextMs <= STEP_PREPARE_MS) {
      var next = nextInTimeline(stepTimeline, at);
      // A YouTube page plays as soon as it loads, so it cannot wait for its turn
      if (playlist[next.index].type !== 'youtube') stepPrepared = stepBuild(next.index, next.cycle + ':' + next.index, 0);
    }
    stepStartEarly(stepPrepared, at);
    if (at.untilNextMs <= STEP_TICK_MS) {
      if (stepBoundary) clearTimeout(stepBoundary);
      stepBoundary = setTimeout(stepTick, Math.max(0, at.untilNextMs));
    }
  }

  function stepRun(lengths, fallback) {
    stepTimeline = buildTimeline(lengths);
    if (!(stepTimeline.total > 0)) { fallback(); return; }
    stepActive = true;
    showLoading();
    stepTick();
    setInterval(stepTick, STEP_TICK_MS);
  }

  function startInStep(fallback) {
    var lengths = [];
    var unknown = [];
    for (var i = 0; i < playlist.length; i++) {
      var item = playlist[i];
      if (item.type === 'youtube') {
        if (!item.capSeconds) { fallback(); return; }
        lengths.push(item.capSeconds * 1000);
      } else if (item.type === 'video') {
        lengths.push(item.durationMs || 0);
        if (!item.durationMs) unknown.push(i);
      } else {
        lengths.push(item.duration * 1000);
      }
    }
    if (unknown.length === 0) { stepRun(lengths, fallback); return; }

    // A video given by address: the cloud could not read it, so each screen does. Rounded up to a tenth
    // of a second, so that a hair of difference between two WebViews gives the same number.
    var left = unknown.length;
    var gaveUp = false;
    function giveUp() {
      if (gaveUp) return;
      gaveUp = true;
      fallback();
    }
    unknown.forEach(function(index) {
      var probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.muted = true;
      var timer = setTimeout(giveUp, 20000);
      probe.addEventListener('loadedmetadata', function() {
        clearTimeout(timer);
        if (!isFinite(probe.duration) || !(probe.duration > 0)) { giveUp(); return; }
        lengths[index] = Math.ceil(probe.duration * 10) * 100;
        probe.removeAttribute('src');
        left -= 1;
        if (left === 0 && !gaveUp) stepRun(lengths, fallback);
      });
      probe.addEventListener('error', function() { clearTimeout(timer); giveUp(); });
      probe.src = playlist[index].url;
    });
  }
`;
