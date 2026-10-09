/* 클래스카드 매칭 v1.2.0: 콘솔에 전체를 붙여 넣고, 게임 시작은 직접 누르세요.
 * 중지: classcardAuto.stop()  상태: classcardAuto.status()
 * 다시 대기: classcardAuto.start()
 * 점수, 타이머, 저장 요청, 음성 설정은 변경하지 않습니다.
 */
(() => {
  'use strict';

  const VERSION = '1.2.0';

  const previous = window.classcardAuto;
  if (previous && typeof previous.stop === 'function') previous.stop();

  const POLL_MS = 100;
  const CLICK_GAP_MS = 80;
  const RESULT_TIMEOUT_MS = 6000;
  const NO_PAIR_TIMEOUT_MS = 12000;
  const TRANSITIONS = new Set([
    'hideOut', 'leftFadeOut', 'rightFadeOut',
    'leftOutNoAni', 'rightOutNoAni'
  ]);
  let current = null;

  const clean = value => String(value ?? '').replace(/[\u200b\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || !element.isConnected || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  const hasImage = element => Array.from(element?.querySelectorAll('img') ?? [])
    .some(image => image.getAttribute('src'));

  function board() {
    const root = document.querySelector('#match-wrapper');
    const content = root?.querySelector('.match-content');
    const quest = document.querySelector('.quest-list');
    const left = Array.from(root?.querySelectorAll('.match-body.left .flip-card') ?? []);
    const right = Array.from(root?.querySelectorAll('.match-body.right .flip-card') ?? []);
    if (!root || !content || !quest || left.length !== 4 || right.length !== 4) {
      throw new Error('매칭 DOM 구조를 찾을 수 없습니다. 매칭 게임 페이지에서 실행하세요.');
    }
    const scoreElement = Array.from(root.querySelectorAll('.point')).find(visible);
    const scoreText = clean(scoreElement?.textContent).replace(/,/g, '');
    const score = /^-?\d+$/.test(scoreText) ? Number(scoreText) : null;
    const minute = Array.from(root.querySelectorAll('.minutes')).find(visible);
    const second = minute?.parentElement?.querySelector('.seconds');
    const minText = clean(minute?.textContent);
    const secText = clean(second?.textContent);
    const remaining = /^\d+$/.test(minText) && /^\d+$/.test(secText)
      ? Number(minText) * 60 + Number(secText) : null;
    const overlay = Array.from(document.querySelectorAll(
      '.start-match, .start-opt-body, .end-opt-body, .score-end.active'
    )).some(visible);
    const blind = content.querySelector('.card-blind.active');
    const hurry = Array.from(document.querySelectorAll(
      '.hurryup-info, .hurry-text.active, .hurryup-layer'
    )).some(visible);
    const blocked = !visible(root) || !visible(content) || (blind && visible(blind)) ||
      Array.from(document.querySelectorAll('.modal.in')).some(visible) ||
      content.classList.contains('disabled') ||
      Array.from(content.querySelectorAll('.match-body')).some(e => e.classList.contains('disabled')) ||
      left.concat(right).some(e => e.classList.contains('hint'));
    return { root, quest, left, right, score, remaining, overlay, blocked, hurry,
      ended: overlay || remaining === 0,
      live: !overlay && remaining !== null && remaining > 0 && visible(root) };
  }

  function ready(slot, allowEntering = false) {
    if (!visible(slot) || ['disabled', 'hint', 'correct', 'wrong', 'answer', 'flip']
      .some(name => slot.classList.contains(name))) return false;
    const inner = slot.querySelector('.flip-card-inner');
    if (!inner) return false;
    // Native replacement keeps hideOut on the inner element until FadeIn ends.
    // NEW content can be selected while entering. The second click must wait
    // for the site's entry handler to remove these classes: otherwise the
    // delayed judgement can unbind that handler and consume its end event.
    const entering = inner.classList.contains('leftFadeIn') || inner.classList.contains('rightFadeIn');
    if (entering) return allowEntering;
    return !Array.from(inner.classList).some(name => TRANSITIONS.has(name));
  }

  function leftCard(slot) {
    const text = slot.querySelector('.match-text');
    if (!clean(text?.textContent)) return null;
    if (hasImage(text)) throw new Error('이미지 문제는 지원하지 않습니다.');
    const icon = text.querySelector('.btn_audio i[data-idx]');
    const id = icon?.getAttribute('data-idx');
    if (!id || !/^\d+$/.test(id)) throw new Error('왼쪽 카드의 원본 ID를 읽을 수 없습니다.');
    const meaning = document.getElementById(`m${id}`);
    const word = document.getElementById(`w${id}`);
    if (!meaning || !word) throw new Error(`원본 카드 ${id}를 찾을 수 없습니다.`);
    if (hasImage(meaning)) throw new Error('이미지 문제는 지원하지 않습니다.');
    const front = clean(text.querySelector('div')?.textContent);
    const back = clean(meaning.textContent);
    if (!front || !back) throw new Error(`카드 ${id}의 단어 또는 뜻이 비어 있습니다.`);
    const audioOnly = !text.querySelector('.btn_audio')?.classList.contains('hidden');
    return { slot, id, front, back, audioOnly, rawBack: meaning.textContent.trim(),
      // Hurry UP changes the award without changing the card's identity.
      signature: JSON.stringify([id, front, back, icon.getAttribute('data-src'), audioOnly]) };
  }

  function rightCard(slot) {
    const text = slot.querySelector('.match-text');
    const raw = text?.textContent.trim() ?? '';
    if (!raw) return null;
    if (hasImage(text)) throw new Error('이미지 문제는 지원하지 않습니다.');
    return { slot, raw, text: clean(raw), signature: clean(raw) };
  }

  function cardData() {
    let list = Array.isArray(window.card_list) ? window.card_list : null;
    if (!list) {
      for (const script of document.scripts) {
        if (script.src) continue;
        const match = script.textContent.match(/\b(?:var|let|const)\s+card_list\s*=\s*(\[[^\r\n]*\])\s*;/);
        if (match) { list = JSON.parse(match[1]); break; }
      }
    }
    return new Map((list ?? []).map(item => [String(item.card_idx), item]));
  }

  function serviceMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !clean(a) || !clean(b)) return false;
    // Use the service's own filtered comparison whenever it is available.
    if (typeof window.checkAnswer === 'function') {
      return Boolean(window.checkAnswer(a.trim(), b.trim(), false, true));
    }
    return clean(a) === clean(b);
  }

  function findPair(view, session, allowEntering = false) {
    const left = view.left.filter(slot => ready(slot, allowEntering)).map(leftCard).filter(Boolean);
    const right = view.right.filter(slot => ready(slot, allowEntering)).map(rightCard).filter(Boolean);
    // All exact matches take precedence over filtered or alternative matches.
    for (const a of left) for (const b of right) {
      if (a.back === b.text && serviceMatch(a.rawBack, b.raw)) return { left: a, right: b };
    }
    for (const a of left) for (const b of right) {
      if (serviceMatch(a.rawBack, b.raw)) return { left: a, right: b };
      const alternatives = session.data.get(a.id)?.other_answer_back;
      if (Array.isArray(alternatives) && alternatives.some(answer => serviceMatch(answer, b.raw))) {
        return { left: a, right: b };
      }
    }
    // Resolve each right meaning once, rather than scanning the entire source
    // list for every left/right combination and repeatedly forcing DOM reads.
    for (const b of right) {
      for (const [id, record] of session.frontAlternatives) {
        const meaning = document.getElementById(`m${id}`);
        if (meaning && serviceMatch(meaning.textContent, b.raw)) {
          for (const a of left) {
            // Native code compares the entire left slot text, including points.
            if (record.other_answer_front.some(answer => serviceMatch(a.slot.textContent.trim(), answer))) {
              return { left: a, right: b };
            }
          }
        }
      }
    }
    return null;
  }

  function wait(session, milliseconds = POLL_MS, observe = true) {
    if (session.controller.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.controller.signal.removeEventListener('abort', done);
        if (session.wake === done) session.wake = null;
        resolve();
      };
      const timer = setTimeout(done, milliseconds);
      if (observe) session.wake = done;
      session.controller.signal.addEventListener('abort', done, { once: true });
    });
  }

  function cleanup(session) {
    session.observer?.disconnect();
    window.removeEventListener('pagehide', session.onLeave);
    session.controller.abort();
  }

  function finish(session, state, error = null) {
    if (current !== session || session.controller.signal.aborted) return;
    session.state = state;
    session.lastError = error;
    cleanup(session);
    const result = status();
    if (error) console.error('[classcardAuto]', error, result);
    else console.info('[classcardAuto]', state === 'finished' ? '게임 종료' : '중지', result);
  }

  function status() {
    if (!current) return { version: VERSION, state: 'idle', matchedPairs: 0, audioPairs: 0, score: null, lastError: null };
    return { version: VERSION, state: current.state, matchedPairs: current.matchedPairs,
      audioPairs: current.audioPairs, score: current.score, lastError: current.lastError };
  }

  function active(session) {
    if (current !== session || session.controller.signal.aborted) return false;
    if (location.href !== session.url) {
      finish(session, 'stopped');
      return false;
    }
    return true;
  }

  async function solve(pair, session) {
    if (!active(session)) return;
    const fresh = board();
    if (fresh.ended) { finish(session, 'finished'); return; }
    const a = leftCard(pair.left.slot);
    const b = rightCard(pair.right.slot);
    if (fresh.blocked || !ready(pair.left.slot, true) || !ready(pair.right.slot, true) ||
      a?.signature !== pair.left.signature || b?.signature !== pair.right.signature) return;
    if (fresh.left.concat(fresh.right).some(e =>
      ['clicked', 'draged', 'dropped'].some(name => e.classList.contains(name)))) {
      throw new Error('이미 선택된 카드가 있습니다. 현재 선택 또는 판정이 끝난 뒤 다시 시작하세요.');
    }
    const baseline = fresh.score;
    if (baseline === null) throw new Error('현재 점수를 읽을 수 없습니다.');
    const expectedPoints = Number(clean(pair.left.slot.querySelector('.card-score')?.textContent));
    if (!Number.isInteger(expectedPoints) || expectedPoints <= 0) {
      throw new Error('선택한 카드의 획득 점수를 읽을 수 없습니다.');
    }
    const acceptedPoints = new Set([expectedPoints]);
    const hurryAwards = new Map([[100, [130]], [150, [130, 200]], [50, [80]]]);
    const observeAward = view => {
      // Judgement occurs 500 ms after the second click. Hurry UP can run
      // inside that window; its DOM mutations may be observed after judgement.
      if (view.hurry) for (const points of hurryAwards.get(expectedPoints) ?? []) acceptedPoints.add(points);
      const sameCard = pair.left.slot.querySelector('.btn_audio i[data-idx]')?.getAttribute('data-idx') === pair.left.id;
      if (!sameCard) return;
      const points = Number(clean(pair.left.slot.querySelector('.card-score')?.textContent));
      if (!acceptedPoints.has(points)) throw new Error(`선택한 카드의 점수가 예상 밖으로 변경되었습니다. (${expectedPoints}→${points})`);
    };
    observeAward(fresh);
    pair.left.slot.click();
    await wait(session, CLICK_GAP_MS, false);
    if (!active(session)) return;
    const entryDeadline = performance.now() + RESULT_TIMEOUT_MS;
    while (active(session)) {
      const check = board();
      session.score = check.score ?? session.score;
      if (check.ended) { finish(session, 'finished'); return; }
      observeAward(check);
      const selected = check.left.concat(check.right).filter(e =>
        ['clicked', 'draged', 'dropped'].some(name => e.classList.contains(name)));
      if (check.blocked || !ready(pair.left.slot, true) || !ready(pair.right.slot, true) ||
        leftCard(pair.left.slot)?.signature !== pair.left.signature ||
        rightCard(pair.right.slot)?.signature !== pair.right.signature ||
        selected.some(e => e !== pair.left.slot) || check.score !== baseline) {
        throw new Error('첫 클릭 후 카드 또는 입력 상태가 바뀌어 추가 클릭을 중지했습니다.');
      }
      if (ready(pair.left.slot) && ready(pair.right.slot)) break;
      if (performance.now() >= entryDeadline) throw new Error('6초 안에 카드 등장 완료 신호를 확인하지 못했습니다.');
      await wait(session);
    }
    if (!active(session)) return;
    pair.right.slot.click();
    const deadline = performance.now() + RESULT_TIMEOUT_MS;
    let correctSeen = false;
    while (active(session)) {
      const result = board();
      session.score = result.score ?? session.score;
      if (result.score !== null && result.score < baseline) throw new Error('점수가 감소하여 중지했습니다.');
      observeAward(result);
      const solved = document.getElementById(`w${pair.left.id}`)?.getAttribute('data-solve') === 'e';
      correctSeen ||= pair.left.slot.classList.contains('correct') && pair.right.slot.classList.contains('correct');
      const leftReplaced = pair.left.slot.querySelector('.btn_audio i[data-idx]')?.getAttribute('data-idx') !== pair.left.id;
      const rightReplaced = clean(pair.right.slot.querySelector('.match-text')?.textContent) !== pair.right.signature;
      // Native code can delete its slot ID before marking #w{ID} as solved.
      // Require the expected score change AND a separate native completion signal.
      const confirmed = solved || correctSeen || (leftReplaced && rightReplaced);
      if (confirmed && result.score !== null && acceptedPoints.has(result.score - baseline)) {
        session.matchedPairs++;
        if (pair.left.audioOnly) session.audioPairs++;
        session.noPairSince = null;
        if (session.matchedPairs % 20 === 0) console.info('[classcardAuto]', status());
        if (result.ended) finish(session, 'finished');
        return;
      }
      if (result.ended) { finish(session, 'finished'); return; }
      if ([pair.left.slot, pair.right.slot].some(e => e.classList.contains('wrong'))) {
        throw new Error('서비스에서 오답으로 판정하여 중지했습니다.');
      }
      if (performance.now() >= deadline) {
        throw new Error(`6초 안에 정답 판정을 확인하지 못했습니다. (점수 ${baseline}→${result.score}, 허용 증가 ${[...acceptedPoints].join('/')}, 정답 표시 ${correctSeen})`);
      }
      await wait(session);
    }
  }

  async function run(session) {
    while (active(session)) {
      const view = board();
      session.score = view.score ?? session.score;
      if (!session.began) {
        if (!view.live) { await wait(session); continue; }
        session.began = true;
        session.state = 'running';
        session.gameDeadline = performance.now() + (view.remaining + 15) * 1000;
        console.info('[classcardAuto] 자동 정답 입력 시작');
      }
      if (view.ended) { finish(session, 'finished'); return; }
      if (performance.now() >= session.gameDeadline) throw new Error('게임 종료 확인 시간이 초과되었습니다.');
      if (session.noPairSince === null) session.noPairSince = performance.now();
      if (performance.now() - session.noPairSince >= NO_PAIR_TIMEOUT_MS) {
        throw new Error('12초 동안 입력 가능한 정답 쌍을 찾지 못했습니다.');
      }
      if (!view.blocked) {
        // Prefer a fully entered pair. If only new cards match, overlap the
        // first selection and 80 ms gap with entry, while keeping judgement safe.
        const pair = findPair(view, session) ?? findPair(view, session, true);
        if (pair) { await solve(pair, session); continue; }
      }
      await wait(session);
    }
  }

  function stop() {
    if (current && !current.controller.signal.aborted) finish(current, 'stopped');
    return status();
  }

  function start() {
    stop();
    const session = { controller: new AbortController(), state: 'waiting',
      matchedPairs: 0, audioPairs: 0, score: null, lastError: null,
      began: false, noPairSince: null, url: location.href, wake: null };
    current = session;
    try {
      board();
      session.data = cardData();
      session.frontAlternatives = [...session.data].filter(([, item]) =>
        Array.isArray(item.other_answer_front) && item.other_answer_front.length > 0);
      session.observer = new MutationObserver(() => session.wake?.());
      session.observer.observe(document.body, { subtree: true, childList: true,
        characterData: true, attributes: true,
        attributeFilter: ['class', 'style', 'data-solve', 'data-idx', 'data-src', 'src'] });
      session.onLeave = () => finish(session, 'stopped');
      window.addEventListener('pagehide', session.onLeave);
      console.info('[classcardAuto] 대기 중. 게임 시작/재도전은 직접 누르세요. 중지: classcardAuto.stop()');
      run(session).catch(error => {
        if (active(session)) finish(session, 'error', error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      finish(session, 'error', error instanceof Error ? error.message : String(error));
    }
    return status();
  }

  window.classcardAuto = Object.freeze({ start, stop, status });
  start();
})();
