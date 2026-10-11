/* =========================================================
   site-fixes.js – Dược sĩ Phi Phượng
   1) Gửi THẬT dữ liệu các form (tư vấn, liên hệ, ứng tuyển, nhận cẩm nang,
      bản tin) về Google Sheet + email (cấu hình trong site-config.js).
   2) Ô tìm kiếm hoạt động (tìm bài trong website qua Google).
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.PP_CONFIG || {};
  var ZALO = 'https://zalo.me/0934386231';
  var PAGE = location.pathname.split('/').pop() || 'index.html';
  var cache = {};   // giá trị khách đã nhập (giữ qua các bước của form nhiều bước)
  var picks = [];   // các lựa chọn khách bấm trong form nhiều bước

  var SUBMIT_RE = /^(gửi|đăng ký)/i;
  var SKIP_RE = /(khác)$/i;
  var STEP_RE = /^(tiếp tục|←|quay lại|làm lại|bài|tìm hiểu)/i;

  function txt(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function fieldName(el) {
    if (el.id) {
      var lb = document.querySelector('label[for="' + el.id + '"]');
      var lt = (lb && lb.textContent || '').replace(/\s+/g, ' ').trim();
      if (lt) return lt.replace(/\*$/, '').trim();
    }
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || el.type;
  }

  function isTracked(el) {
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return false;
    return !/^(search|button|submit|hidden)$/i.test(el.type || '');
  }

  function remember(e) { if (isTracked(e.target)) cache[fieldName(e.target)] = e.target.value; }
  document.addEventListener('input', remember, true);
  document.addEventListener('change', remember, true);

  function toast(html, isErr) {
    var old = document.querySelector('.pp-toast'); if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'pp-toast' + (isErr ? ' pp-err' : '');
    t.setAttribute('role', isErr ? 'alert' : 'status');
    t.innerHTML = html;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 7000);
  }

  function scopeOf(btn) {
    for (var n = btn.parentElement, i = 0; n && i < 8; i++, n = n.parentElement) {
      if (n.querySelector('input:not([type=search]), textarea, select')) return n;
    }
    return null;
  }

  function collect(scope, useCache) {
    var data = {};
    if (useCache) Object.keys(cache).forEach(function (k) { if (cache[k]) data[k] = cache[k]; });
    if (scope) scope.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (isTracked(el) && el.value) data[fieldName(el)] = el.value;
    });
    return data;
  }

  function findContact(data) {
    var phone = '', email = '';
    Object.keys(data).forEach(function (k) {
      var v = String(data[k]).trim();
      if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) email = v;
      if (!phone && /^(\+?84|0)\d{8,10}$/.test(v.replace(/[\s.\-()]/g, ''))) phone = v;
    });
    return { phone: phone, email: email };
  }

  function hasOwnHandler(btn) {
    for (var k in btn) {
      if (k.indexOf('__reactProps') === 0 && btn[k] && typeof btn[k].onClick === 'function') return true;
    }
    return /\{\{/.test(btn.getAttribute('onClick') || '');
  }

  // Tách các ô quen thuộc ra cột riêng cho Google Sheet
  function pick(data, re) {
    var out = [];
    Object.keys(data).forEach(function (k) { if (re.test(k)) out.push(data[k]); });
    return out.join(' | ');
  }

  function send(formName, data, contact) {
    var now = new Date();
    var record = {
      'Thời gian': now.toLocaleString('vi-VN'),
      'Loại form': formName,
      'Họ và tên': pick(data, /tên/i),
      'Số điện thoại': contact.phone,
      'Email': contact.email,
      'Nhu cầu / Chủ đề': pick(data, /quan tâm|chủ đề|hình thức|nhu cầu/i),
      'Ghi chú / Nội dung': pick(data, /tình trạng|nội dung|ghi chú|câu hỏi|lời nhắn/i),
      'Trang': PAGE,
      'Các lựa chọn': picks.join(' | '),
      'Toàn bộ thông tin': Object.keys(data).map(function (k) { return k + ': ' + data[k]; }).join('\n')
    };
    var jobs = [];

    if (CFG.SHEET_URL) {
      // Apps Script không trả CORS → gửi kiểu "no-cors", dữ liệu vẫn ghi vào Sheet
      jobs.push(fetch(CFG.SHEET_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(record)
      }));
    }
    if (CFG.EMAIL_URL) {
      var mail = {
        _subject: '[Website] ' + formName + ' – ' + (contact.phone || contact.email),
        _template: 'table', _captcha: 'false'
      };
      if (contact.email) mail._replyto = contact.email;
      Object.keys(record).forEach(function (k) { if (record[k] && k !== 'Toàn bộ thông tin') mail[k] = record[k]; });
      Object.keys(data).forEach(function (k) { if (!(k in mail)) mail[k] = data[k]; });
      jobs.push(fetch(CFG.EMAIL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(mail)
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); }));
    }
    if (!jobs.length) return Promise.reject(new Error('Chưa cấu hình nơi nhận'));

    // Thành công nếu ÍT NHẤT 1 nơi nhận được
    return new Promise(function (resolve, reject) {
      var left = jobs.length, ok = false;
      jobs.forEach(function (j) {
        j.then(function () { ok = true; }, function () {}).then(function () {
          if (--left === 0) { ok ? resolve() : reject(new Error('Gửi thất bại')); }
        });
      });
    }).then(function () {
      try { if (window.gtag) window.gtag('event', 'generate_lead', { form_name: formName }); } catch (e) {}
      try { if (window.fbq) window.fbq('track', 'Lead', { content_name: formName }); } catch (e) {}
    });
  }

  function failMsg() {
    toast('Xin lỗi, chưa gửi được do lỗi mạng. Anh chị nhắn giúp Phượng qua <a href="' + ZALO + '" target="_blank" rel="noopener">Zalo 0934 386 231</a> nhé.', true);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('button');
    if (!btn) return;
    var label = txt(btn);

    if (/^tìm$/i.test(label)) { e.preventDefault(); doSearch(btn); return; }

    if (!SUBMIT_RE.test(label)) {
      // Ghi nhận lựa chọn trong form nhiều bước (VD: ứng tuyển coaching)
      if (label && label.length < 80 && !STEP_RE.test(label) && !btn.getAttribute('aria-expanded') &&
          !btn.getAttribute('aria-label') && picks.indexOf(label) < 0 && scopeOf(btn)) picks.push(label);
      return;
    }
    if (SKIP_RE.test(label)) { picks = []; return; }

    var scope = scopeOf(btn);
    var isNewsletter = /^đăng ký$/i.test(label) || /cho tôi$/i.test(label);
    var data = collect(scope, !isNewsletter);
    var contact = findContact(data);

    if (!contact.phone && !contact.email) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      var el = scope && scope.querySelector('input[type=tel], input[type=email]');
      if (el) { el.classList.add('pp-field-error'); el.focus(); setTimeout(function () { el.classList.remove('pp-field-error'); }, 4000); }
      toast(isNewsletter ? 'Anh chị nhập giúp Phượng một email hợp lệ nhé.'
                         : 'Anh chị để lại giúp Phượng số điện thoại (hoặc email) để Phượng liên hệ nhé.', true);
      return;
    }

    var formName = label.replace(/\s*–.*$/, '').trim();
    if (/^gửi đăng ký$/i.test(formName)) formName = 'Đăng ký tư vấn miễn phí';
    if (/^đăng ký$/i.test(label)) formName = 'Đăng ký nhận bản tin';

    send(formName, data, contact).catch(failMsg);
    picks = [];

    if (!hasOwnHandler(btn)) {
      // Nút không có xử lý gốc (ô email bản tin, nhận cẩm nang) → tự báo & xoá ô
      e.preventDefault();
      if (scope) scope.querySelectorAll('input:not([type=search])').forEach(function (i) { i.value = ''; });
      toast('Cảm ơn anh chị! Phượng đã nhận thông tin và sẽ gửi sớm nhất. Cần gấp, nhắn <a href="' + ZALO + '" target="_blank" rel="noopener">Zalo 0934 386 231</a>.');
    }
  }, true);

  // --- Tìm kiếm trong website ---
  function doSearch(from) {
    var box = null;
    if (from && from.type === 'search') box = from;
    for (var n = from && from.parentElement, i = 0; n && i < 4 && !box; i++, n = n.parentElement) box = n.querySelector('input[type=search]');
    box = box || document.querySelector('input[type=search]');
    var q = box ? box.value.trim() : '';
    if (!q) { if (box) box.focus(); return; }
    window.open('https://www.google.com/search?q=' + encodeURIComponent('site:duocsiphiphuong.com ' + q), '_blank', 'noopener');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.type === 'search') { e.preventDefault(); doSearch(e.target); }
  }, true);
})();
