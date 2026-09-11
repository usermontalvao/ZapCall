// A casca compartilhada de TODAS as telas do ZapCall: tokens de tema (claro,
// escuro e "sistema"), a barra fixa (marca, abas, idioma, tema), o estado
// global de idioma/tema e utilitarios de UI (toast, flash, i18n).
//
// Servido em /static/zc-ui.js pelo gerente E por cada instancia (o discador e
// a pagina de pareamento vivem atras do proxy, e tambem sozinhos). Sem
// dependencia externa: o painel funciona dentro do container, offline.
//
// Idiomas: acrescentar um idioma = uma entrada em LANGS + as chaves no
// dicionario de cada pagina (chave ausente cai no ingles, depois no portugues).
(() => {
  'use strict';
  const LANGS = {
    pt: { nome: 'Português', curto: 'PT', locale: 'pt-BR' },
    en: { nome: 'English', curto: 'EN', locale: 'en-US' },
    es: { nome: 'Español', curto: 'ES', locale: 'es-ES' },
  };
  const ler = (k, padrao) => { try { return localStorage.getItem(k) || padrao; } catch { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const idiomaDoNavegador = () => { const n = String((navigator.language || 'en')).slice(0, 2).toLowerCase(); return LANGS[n] ? n : 'en'; };
  const estado = {
    lang: LANGS[ler('zc.lang', '')] ? ler('zc.lang', '') : idiomaDoNavegador(),
    // "system" segue o sistema operacional; a escolha explicita fica guardada.
    theme: ['light', 'dark', 'system'].includes(ler('zc.theme', 'system')) ? ler('zc.theme', 'system') : 'system',
  };
  const ouvintes = new Set();
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const temaEfetivo = () => estado.theme === 'system' ? (mq && mq.matches ? 'dark' : 'light') : estado.theme;

  // ------------------------------------------------------------ tokens
  // Paleta neutra, de produto: cinzas frios, bordas de 1 px, acento verde
  // so onde ha acao ou estado "ok". Todo token existe nos dois temas.
  const CSS = `
:root, [data-theme="light"] {
  color-scheme: light;
  --bg:#f6f8fa; --bg-2:#ffffff; --panel:#ffffff; --panel-2:#f6f8fa; --panel-3:#eaeef2;
  --ink:#1f2328; --ink-2:#424a53; --muted:#59636e; --faint:#818b98;
  --line:#d1d9e0; --line-2:#b8c2cc; --line-soft:#e8ecf0;
  --brand:#1f883d; --brand-ink:#1a7f37; --brand-soft:#dafbe1; --brand-line:#4ac26b; --on-brand:#ffffff;
  --accent:#0969da; --accent-soft:#ddf4ff; --accent-line:#54aeff;
  --warn:#9a6700; --warn-soft:#fff8c5; --warn-line:#d4a72c;
  --danger:#cf222e; --danger-ink:#a40e26; --danger-soft:#ffebe9; --danger-line:#ff8182; --on-danger:#ffffff;
  --live:#8250df; --live-soft:#fbefff; --live-line:#c297ff;
  --code-bg:#f6f8fa; --code-ink:#1f2328; --code-line:#d1d9e0;
  --shadow:0 1px 0 rgba(31,35,40,.04); --shadow-lg:0 8px 24px rgba(140,149,159,.2); --glow:0 0 0 3px rgba(9,105,218,.3);
  --radius:6px; --radius-lg:10px; --nav-h:56px; --tabs-h:46px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
[data-theme="dark"] {
  color-scheme: dark;
  --bg:#0d1117; --bg-2:#010409; --panel:#161b22; --panel-2:#0d1117; --panel-3:#21262d;
  --ink:#e6edf3; --ink-2:#c9d1d9; --muted:#8d96a0; --faint:#6e7681;
  --line:#30363d; --line-2:#3d444d; --line-soft:#21262d;
  --brand:#238636; --brand-ink:#3fb950; --brand-soft:rgba(46,160,67,.15); --brand-line:#2ea043; --on-brand:#ffffff;
  --accent:#2f81f7; --accent-soft:rgba(56,139,253,.15); --accent-line:#1f6feb;
  --warn:#d29922; --warn-soft:rgba(187,128,9,.15); --warn-line:#9e6a03;
  --danger:#f85149; --danger-ink:#ff7b72; --danger-soft:rgba(248,81,73,.15); --danger-line:#da3633; --on-danger:#ffffff;
  --live:#a371f7; --live-soft:rgba(163,113,247,.15); --live-line:#8957e5;
  --code-bg:#0d1117; --code-ink:#e6edf3; --code-line:#30363d;
  --shadow:0 0 transparent; --shadow-lg:0 8px 24px rgba(1,4,9,.6); --glow:0 0 0 3px rgba(47,129,247,.35);
}
html { background:var(--bg); }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 var(--font); -webkit-font-smoothing:antialiased; }
body.zc-com-nav { padding-top:var(--nav-h); }
body.zc-com-abas { padding-top:calc(var(--nav-h) + var(--tabs-h)); }
*, *::before, *::after { box-sizing:border-box; }
button, input, select, textarea { font:inherit; color:inherit; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
code, kbd { font:12px/1.5 var(--mono); background:var(--panel-3); padding:.15em .4em; border-radius:6px; }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }

/* ---------------------------------------------------------------- barra */
.zc-nav { position:fixed; top:0; left:0; right:0; height:var(--nav-h); z-index:100; display:flex; align-items:center; gap:14px; padding:0 20px;
  background:var(--bg-2); border-bottom:1px solid var(--line); }
[data-theme="dark"] .zc-nav { background:var(--bg-2); }
.zc-nav .zc-marca { display:flex; align-items:center; gap:10px; font-weight:600; font-size:15px; color:var(--ink); text-decoration:none; }
.zc-nav .zc-marca svg { width:28px; height:28px; }
.zc-nav .zc-marca .zc-sub { color:var(--muted); font-weight:400; }
.zc-nav .zc-marca .zc-sep { color:var(--line-2); font-weight:300; margin:0 2px; }
.zc-nav .zc-dir { margin-left:auto; display:flex; align-items:center; gap:8px; }
.zc-nav .zc-extra { display:flex; align-items:center; gap:8px; }
.zc-nav .zc-menu { display:none; }
.zc-abas { position:fixed; top:var(--nav-h); left:0; right:0; height:var(--tabs-h); z-index:99; background:var(--bg-2); border-bottom:1px solid var(--line); }
.zc-abas nav { max-width:1280px; margin:0 auto; padding:0 12px; display:flex; gap:4px; height:100%; overflow-x:auto; scrollbar-width:none; }
.zc-abas nav a { display:inline-flex; align-items:center; gap:7px; padding:0 10px; height:100%; color:var(--ink); font-size:14px; border-bottom:2px solid transparent; white-space:nowrap; text-decoration:none; }
.zc-abas nav a:hover { background:var(--panel-3); border-radius:6px 6px 0 0; text-decoration:none; }
.zc-abas nav a.ativo { font-weight:600; border-bottom-color:#fd8c73; }
.zc-abas nav a svg { width:16px; height:16px; color:var(--muted); }
.zc-abas nav a .zc-cont { font-size:12px; background:var(--panel-3); color:var(--ink); border-radius:999px; padding:0 6px; min-width:20px; text-align:center; line-height:18px; }

/* ------------------------------------------------------------- controles */
.zc-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:5px 12px; min-height:32px; border-radius:6px; border:1px solid var(--line-2);
  background:var(--panel-2); color:var(--ink); font-weight:500; font-size:14px; cursor:pointer; white-space:nowrap; line-height:20px; transition:background .12s,border-color .12s; }
[data-theme="dark"] .zc-btn { background:var(--panel-3); border-color:var(--line-2); }
.zc-btn:hover { background:var(--panel-3); border-color:var(--faint); text-decoration:none; }
[data-theme="dark"] .zc-btn:hover { background:#30363d; }
.zc-btn:active { background:var(--line-soft); }
.zc-btn.primario { background:var(--brand); border-color:rgba(31,35,40,.15); color:var(--on-brand); }
.zc-btn.primario:hover { background:var(--brand-ink); } [data-theme="dark"] .zc-btn.primario:hover { background:#2ea043; }
.zc-btn.perigo { color:var(--danger); } .zc-btn.perigo:hover { background:var(--danger); color:var(--on-danger); border-color:var(--danger-line); }
.zc-btn.fantasma { background:transparent; border-color:transparent; color:var(--accent); } .zc-btn.fantasma:hover { background:var(--panel-3); }
.zc-btn.pequeno { padding:3px 10px; min-height:28px; font-size:12.5px; }
.zc-btn.icone { padding:5px; width:32px; }
.zc-btn:disabled { opacity:.5; cursor:not-allowed; }
.zc-btn svg { width:16px; height:16px; flex:none; }
.zc-seg { display:inline-flex; border:1px solid var(--line-2); border-radius:6px; overflow:hidden; background:var(--panel-2); }
.zc-seg button { border:0; background:transparent; padding:5px 10px; min-height:30px; font-size:13px; color:var(--muted); cursor:pointer; display:inline-flex; align-items:center; gap:6px; border-right:1px solid var(--line-2); }
.zc-seg button:last-child { border-right:0; }
.zc-seg button.ativo { background:var(--panel-3); color:var(--ink); font-weight:600; }
.zc-seg button svg { width:14px; height:14px; }
.zc-select { appearance:none; -webkit-appearance:none; padding:5px 28px 5px 10px; min-height:32px; border:1px solid var(--line-2); border-radius:6px; background:var(--panel-2) no-repeat right 8px center; background-size:12px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23818b98'%3E%3Cpath d='M4.4 6l3.6 3.6L11.6 6z'/%3E%3C/svg%3E"); color:var(--ink); font-size:13px; cursor:pointer; }
.zc-input { padding:5px 12px; min-height:32px; border:1px solid var(--line-2); border-radius:6px; background:var(--panel-2); color:var(--ink); width:100%; }
.zc-input:focus { border-color:var(--accent); box-shadow:var(--glow); outline:0; }
.zc-input.invalida { border-color:var(--danger); box-shadow:0 0 0 3px var(--danger-soft); }
.zc-label { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:500; line-height:18px; padding:0 8px; border-radius:999px; border:1px solid var(--line-2); color:var(--muted); background:transparent; white-space:nowrap; }
.zc-label::before { content:''; width:8px; height:8px; border-radius:50%; background:currentColor; flex:none; }
.zc-label.ok { color:var(--brand-ink); border-color:var(--brand-line); background:var(--brand-soft); }
.zc-label.aviso { color:var(--warn); border-color:var(--warn-line); background:var(--warn-soft); }
.zc-label.ruim { color:var(--danger); border-color:var(--danger-line); background:var(--danger-soft); }
.zc-label.info { color:var(--accent); border-color:var(--accent-line); background:var(--accent-soft); }
.zc-label.uso { color:var(--live); border-color:var(--live-line); background:var(--live-soft); }
.zc-label.uso::before { animation:zc-pisca 1s ease-in-out infinite; }
.zc-label.neutro::before { display:none; }
@keyframes zc-pisca { 0%,100% { opacity:1 } 50% { opacity:.25 } }

/* ---------------------------------------------------------------- caixas */
.zc-box { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); }
.zc-box > header, .zc-box-h { display:flex; align-items:center; gap:10px; padding:10px 16px; background:var(--panel-2); border-bottom:1px solid var(--line); border-radius:var(--radius) var(--radius) 0 0; font-weight:600; }
.zc-box > header .zc-dir { margin-left:auto; display:flex; gap:6px; align-items:center; }
.zc-box > .zc-corpo { padding:16px; }
.zc-flash { display:flex; gap:10px; align-items:flex-start; padding:10px 14px; border:1px solid var(--accent-line); background:var(--accent-soft); border-radius:var(--radius); color:var(--ink); }
.zc-flash svg { width:16px; height:16px; flex:none; margin-top:2px; }
.zc-flash.aviso { border-color:var(--warn-line); background:var(--warn-soft); }
.zc-flash.erro { border-color:var(--danger-line); background:var(--danger-soft); }
.zc-flash.ok { border-color:var(--brand-line); background:var(--brand-soft); }
.zc-flash .zc-x { margin-left:auto; background:none; border:0; cursor:pointer; color:var(--muted); padding:0 2px; }
.zc-toasts { position:fixed; right:16px; bottom:16px; display:grid; gap:8px; z-index:400; }
.zc-toast { display:flex; align-items:center; gap:10px; background:var(--panel); color:var(--ink); border:1px solid var(--line-2); border-left:4px solid var(--accent); padding:10px 14px; border-radius:6px; font-size:13.5px; box-shadow:var(--shadow-lg); max-width:380px; animation:zc-sobe .18s ease; }
.zc-toast.ok { border-left-color:var(--brand-ink); } .zc-toast.erro { border-left-color:var(--danger); } .zc-toast.aviso { border-left-color:var(--warn); }
@keyframes zc-sobe { from { transform:translateY(6px); opacity:0 } }
.zc-skel { background:linear-gradient(90deg,var(--panel-3) 25%,var(--line-soft) 37%,var(--panel-3) 63%); background-size:400% 100%; animation:zc-skel 1.2s ease infinite; border-radius:4px; color:transparent !important; }
@keyframes zc-skel { from { background-position:100% 50% } to { background-position:0 50% } }
.zc-blankslate { text-align:center; padding:48px 24px; border:1px dashed var(--line-2); border-radius:var(--radius); color:var(--muted); display:grid; gap:8px; justify-items:center; }
.zc-blankslate b { color:var(--ink); font-size:18px; }
.zc-blankslate svg { width:40px; height:40px; color:var(--faint); }
.zc-pre { position:relative; background:var(--code-bg); color:var(--code-ink); border:1px solid var(--code-line); border-radius:6px; padding:12px 14px; margin:0; overflow:auto; font:12.5px/1.55 var(--mono); white-space:pre; }
.zc-pre.quebra { white-space:pre-wrap; word-break:break-all; }
.zc-pre:has(.zc-copiar) { padding-right:96px; }
.zc-pre .zc-copiar { position:absolute; top:6px; right:6px; }
.zc-kbd { font:11.5px var(--mono); border:1px solid var(--line-2); border-bottom-width:2px; border-radius:5px; padding:1px 5px; background:var(--panel-2); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
@media (max-width:760px) {
  .zc-nav { padding:0 12px; gap:8px; }
  .zc-nav .zc-extra { display:none; }
  .zc-nav .zc-marca .zc-sub, .zc-nav .zc-marca .zc-sep { display:none; }
  .zc-abas nav { padding:0 6px; }
  .zc-toasts { left:12px; right:12px; } .zc-toast { max-width:none; }
}
`;

  // ---------------------------------------------------------------- logo
  // Uma bolha de conversa atravessada por um raio (o "zap": a chamada que
  // sai na hora). Escala de 16 px a 512 px sem perder o gesto.
  function logo(tamanho = 28) {
    return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="ZapCall" role="img">
      <defs><linearGradient id="zcg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#34d399"/><stop offset="1" stop-color="#15803d"/></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill="url(#zcg)"/>
      <path d="M32 12c-11.6 0-21 8.1-21 18.2 0 4.6 2 8.8 5.3 12L14 50l9.7-3.4a24.6 24.6 0 0 0 8.3 1.4c11.6 0 21-8.1 21-18.2S43.6 12 32 12z" fill="#fff" fill-opacity=".16" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
      <path d="M36.5 20 25 32.5h8.5L27.5 42 40 29.5h-8.5z" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  }

  // Icones (Octicons-like, 16px, stroke) usados pelas paginas.
  const ICONES = {
    sol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    lua: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    servidor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
    pulso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
    engrenagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    livro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    telefone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.8 2z"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-4M14 21h1"/></svg>',
    reiniciar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    lixeira: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    chave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 9-9M16 7l3 3M19 4l2 2"/></svg>',
    externo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7M21 3l-9 9M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    globo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M6 11l6 6 6-6M4 21h16"/></svg>',
    filtro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>',
    pausa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  };

  // ----------------------------------------------------------- idioma/tema
  function aplicar() {
    document.documentElement.dataset.theme = temaEfetivo();
    document.documentElement.lang = LANGS[estado.lang].locale;
    for (const cb of ouvintes) { try { cb(estadoPublico()); } catch {} }
  }
  const estadoPublico = () => ({ lang: estado.lang, theme: estado.theme, themeEfetivo: temaEfetivo() });
  function setLang(l) { if (!LANGS[l]) return; estado.lang = l; gravar('zc.lang', l); aplicar(); }
  function setTheme(t) { estado.theme = ['light', 'dark', 'system'].includes(t) ? t : 'system'; gravar('zc.theme', estado.theme); aplicar(); }
  if (mq) (mq.addEventListener ? mq.addEventListener('change', aplicar) : mq.addListener(aplicar));

  const UI = {
    pt: { idioma: 'Idioma', tema: 'Tema', sistema: 'Sistema', claro: 'Claro', escuro: 'Escuro', copiar: 'Copiar', copiado: 'Copiado', fechar: 'Fechar', menu: 'Menu' },
    en: { idioma: 'Language', tema: 'Theme', sistema: 'System', claro: 'Light', escuro: 'Dark', copiar: 'Copy', copiado: 'Copied', fechar: 'Close', menu: 'Menu' },
    es: { idioma: 'Idioma', tema: 'Tema', sistema: 'Sistema', claro: 'Claro', escuro: 'Oscuro', copiar: 'Copiar', copiado: 'Copiado', fechar: 'Cerrar', menu: 'Menú' },
  };
  /** t(dicionario, chave, variaveis): idioma atual -> ingles -> portugues -> a chave. */
  function t(dic, k, v) {
    let s = (dic[estado.lang] && dic[estado.lang][k]) ?? (dic.en && dic.en[k]) ?? (dic.pt && dic.pt[k]) ?? k;
    if (v) for (const [a, b] of Object.entries(v)) s = s.split('{' + a + '}').join(b);
    return s;
  }
  const tu = (k) => t(UI, k);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * Monta a barra e (opcionalmente) a faixa de abas. `links` =
   * [{ href, rotulo: {pt,en,es}, ativo, icone, contagem, alvo }]; `extra` e
   * HTML (ou funcao) a direita; `sub` e o texto ao lado da marca.
   */
  function nav({ links = [], extra = '', marcaHref = '/', sub = '', abas = true } = {}) {
    document.body.classList.add('zc-com-nav');
    if (abas && links.length) document.body.classList.add('zc-com-abas');
    const el = document.createElement('header');
    el.className = 'zc-nav';
    const faixa = document.createElement('div');
    faixa.className = 'zc-abas';
    const seletores = () => `
      <select class="zc-select" data-zc="lang" aria-label="${tu('idioma')}">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === estado.lang ? 'selected' : ''}>${v.curto} · ${v.nome}</option>`).join('')}</select>
      <div class="zc-seg" data-zc="theme" title="${tu('tema')}">
        <button data-theme="system" class="${estado.theme === 'system' ? 'ativo' : ''}" aria-label="${tu('sistema')}">${ICONES.monitor}</button>
        <button data-theme="light" class="${estado.theme === 'light' ? 'ativo' : ''}" aria-label="${tu('claro')}">${ICONES.sol}</button>
        <button data-theme="dark" class="${estado.theme === 'dark' ? 'ativo' : ''}" aria-label="${tu('escuro')}">${ICONES.lua}</button>
      </div>`;
    const render = () => {
      el.innerHTML = `
        <a class="zc-marca" href="${marcaHref}">${logo(28)}<span>ZapCall</span>${sub ? `<span class="zc-sep">/</span><span class="zc-sub">${esc(typeof sub === 'object' ? (sub[estado.lang] || sub.en || sub.pt) : sub)}</span>` : ''}</a>
        <div class="zc-dir">
          <div class="zc-extra">${typeof extra === 'function' ? extra(estadoPublico()) : extra}</div>
          ${seletores()}
        </div>`;
      el.querySelector('[data-zc="lang"]').onchange = (e) => setLang(e.target.value);
      el.querySelectorAll('[data-zc="theme"] button').forEach(b => b.onclick = () => setTheme(b.dataset.theme));
      if (abas && links.length) {
        faixa.innerHTML = '<nav>' + links.map(l => `<a href="${l.href}" class="${l.ativo ? 'ativo' : ''}" ${l.alvo ? 'target="' + l.alvo + '" rel="noopener"' : ''}>${l.icone ? ICONES[l.icone] || '' : ''}<span>${l.rotulo[estado.lang] || l.rotulo.en || l.rotulo.pt}</span>${l.contagem != null ? '<span class="zc-cont">' + esc(l.contagem) + '</span>' : ''}</a>`).join('') + '</nav>';
      }
    };
    render();
    ouvintes.add(render);
    document.body.prepend(el);
    if (abas && links.length) el.after(faixa);
    return { el, faixa, render, atualizar(novos) { links = novos || links; render(); } };
  }

  // ---------------------------------------------------------- utilitarios
  let toasts = null;
  function toast(msg, tipo = 'info', ms = 3800) {
    if (!toasts) { toasts = document.createElement('div'); toasts.className = 'zc-toasts'; document.body.appendChild(toasts); }
    const el = document.createElement('div'); el.className = 'zc-toast ' + tipo;
    el.innerHTML = (tipo === 'ok' ? ICONES.ok : tipo === 'erro' ? ICONES.alerta : ICONES.info).replace('<svg', '<svg width="16" height="16" style="flex:none;color:var(--' + (tipo === 'ok' ? 'brand-ink' : tipo === 'erro' ? 'danger' : tipo === 'aviso' ? 'warn' : 'accent') + ')"') + '<span></span>';
    el.querySelector('span').textContent = msg;
    toasts.appendChild(el); setTimeout(() => el.remove(), ms);
    return el;
  }
  function flash(msg, tipo = 'info') {
    const el = document.createElement('div'); el.className = 'zc-flash ' + tipo;
    el.innerHTML = (tipo === 'erro' || tipo === 'aviso' ? ICONES.alerta : tipo === 'ok' ? ICONES.ok : ICONES.info) + '<div></div><button class="zc-x" aria-label="' + tu('fechar') + '">' + ICONES.x.replace('<svg', '<svg width="14" height="14"') + '</button>';
    el.querySelector('div').innerHTML = msg;
    el.querySelector('.zc-x').onclick = () => el.remove();
    return el;
  }
  /** Bloco de codigo com botao de copiar. */
  function pre(texto, { quebra = true } = {}) {
    return `<pre class="zc-pre ${quebra ? 'quebra' : ''}"><code>${esc(texto)}</code><button class="zc-btn pequeno zc-copiar" data-zc-copiar type="button">${ICONES.copiar}<span>${tu('copiar')}</span></button></pre>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-zc-copiar]'); if (!b) return;
    const code = b.parentNode.querySelector('code');
    try { await navigator.clipboard.writeText(code ? code.textContent : ''); b.querySelector('span').textContent = tu('copiado'); setTimeout(() => { b.querySelector('span').textContent = tu('copiar'); }, 1400); } catch {}
  });
  const formatarData = (v) => { try { return new Date(v).toLocaleString(LANGS[estado.lang].locale); } catch { return String(v); } };
  const formatarHora = (v) => { try { return new Date(v).toLocaleTimeString(LANGS[estado.lang].locale); } catch { return String(v); } };

  const style = document.createElement('style'); style.id = 'zc-ui'; style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
  if (!document.querySelector('link[rel="icon"]')) { const l = document.createElement('link'); l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = 'static/favicon.svg'; (document.head || document.documentElement).appendChild(l); }
  document.documentElement.dataset.theme = temaEfetivo();
  document.documentElement.lang = LANGS[estado.lang].locale;

  window.ZC = {
    LANGS, ICONES, logo, nav, setLang, setTheme, t, esc, toast, flash, pre, formatarData, formatarHora,
    get lang() { return estado.lang; }, get theme() { return estado.theme; }, get themeEfetivo() { return temaEfetivo(); },
    get locale() { return LANGS[estado.lang].locale; },
    /** Registra um ouvinte de mudanca (idioma/tema) e ja o chama uma vez. */
    onChange(cb) { ouvintes.add(cb); try { cb(estadoPublico()); } catch {} return () => ouvintes.delete(cb); },
  };
})();
