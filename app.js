/* app.js bootstrap: keep this file small and load full logic on demand */
(function bootstrap() {
  const MAIN_SRC = 'app.main.js?v=20260403-3';

  function showBootError(err) {
    const body = document.body;
    if (!body) return;

    const exists = document.getElementById('bootErrorCard');
    if (exists) return;

    const card = document.createElement('div');
    card.id = 'bootErrorCard';
    card.style.cssText = [
      'position:fixed',
      'left:12px',
      'right:12px',
      'bottom:12px',
      'z-index:9999',
      'background:#3a0f17',
      'border:1px solid #ef4444',
      'color:#fee2e2',
      'border-radius:10px',
      'padding:10px 12px',
      'font:12px/1.5 sans-serif'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '앱 로딩 실패';
    title.style.fontWeight = '700';

    const msg = document.createElement('div');
    msg.textContent = String(err?.message || err || '알 수 없는 오류');

    card.appendChild(title);
    card.appendChild(msg);
    body.appendChild(card);
  }

  try {
    if (window.__APP_MAIN_LOADED__) return;

    const script = document.createElement('script');
    script.src = MAIN_SRC;
    script.defer = true;
    script.onload = () => {
      window.__APP_MAIN_LOADED__ = true;
    };
    script.onerror = (e) => {
      showBootError(e?.error || new Error('app.main.js를 불러오지 못했습니다.'));
    };

    document.head.appendChild(script);
  } catch (e) {
    showBootError(e);
  }
})();
