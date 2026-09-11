// O cadastro das instancias, num arquivo so (DATA_DIR/instances.json).
//
// Uma INSTANCIA e uma sessao do WhatsApp Web: um Chrome, um perfil, um numero
// pareado, UMA chamada por vez (regra do proprio WhatsApp Web). Varios canais
// = varias instancias, cada uma no seu processo (src/app.mjs) e na sua porta
// do loopback; quem fala com o mundo e o gerente (src/manager.mjs).
//
// Este modulo nao sobe processo nenhum: e so o cadastro, para ser testavel.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nome de instancia: curto, minusculo, sem espaco — vai na URL e no diretorio. */
export const NOME_VALIDO = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function gerarToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Primeira porta livre a partir da base, pulando as ja cadastradas. A porta
 * do gerente nunca entra na conta: `base` deve ficar acima dela.
 */
export function proximaPorta(instancias, base) {
  const usadas = new Set(instancias.map(i => i.port));
  let p = base;
  while (usadas.has(p)) p += 1;
  return p;
}

export function abrirCadastro({ dataDir, portBase = 18500 }) {
  const arquivo = join(dataDir, 'instances.json');
  mkdirSync(dataDir, { recursive: true });

  let instancias = [];
  if (existsSync(arquivo)) {
    try { instancias = (JSON.parse(readFileSync(arquivo, 'utf8')).instances || []).map(i => ({ webhook: { url: null, enabled: false, events: [] }, ...i })); }
    catch (e) { throw new Error('instances.json ilegivel: ' + e.message); }
  }

  function salvar() {
    // Escrita atomica: um container morto no meio do write nao pode deixar o
    // cadastro pela metade — ali esta a lista de sessoes pareadas.
    const tmp = arquivo + '.tmp';
    writeFileSync(tmp, JSON.stringify({ version: 1, instances: instancias }, null, 2));
    renameSync(tmp, arquivo);
  }

  return {
    get arquivo() { return arquivo; },
    listar() { return instancias.map(i => ({ ...i })); },
    obter(nome) { const i = instancias.find(x => x.name === nome); return i ? { ...i } : null; },

    /** `profileDir` opcional: importa uma sessao ja pareada (perfil existente). */
    criar({ name, channel = null, profileDir = null }) {
      const nome = String(name || '').trim().toLowerCase();
      if (!NOME_VALIDO.test(nome)) throw Object.assign(new Error('nome invalido: use a-z, 0-9, - e _ (ate 32)'), { code: 'invalid_name' });
      if (instancias.some(i => i.name === nome)) throw Object.assign(new Error('ja existe uma instancia ' + nome), { code: 'already_exists' });
      const inst = {
        name: nome,
        // Rotulo livre para o CRM agrupar/exibir (ex.: "Atendimento", "Financeiro").
        channel: channel ? String(channel).slice(0, 64) : null,
        token: gerarToken(),
        port: proximaPorta(instancias, portBase),
        profileDir: profileDir ? String(profileDir) : join(dataDir, 'instances', nome, 'profile'),
        enabled: true,
        // Webhook no estilo da Evolution: cada evento de chamada vira um POST.
        webhook: { url: null, enabled: false, events: [] },
        createdAt: new Date().toISOString(),
      };
      instancias.push(inst);
      salvar();
      return { ...inst };
    },

    atualizar(nome, campos) {
      const inst = instancias.find(x => x.name === nome);
      if (!inst) return null;
      if ('channel' in campos) inst.channel = campos.channel ? String(campos.channel).slice(0, 64) : null;
      if ('enabled' in campos) inst.enabled = !!campos.enabled;
      if ('webhook' in campos && campos.webhook && typeof campos.webhook === 'object') {
        const w = campos.webhook;
        const url = w.url ? String(w.url).trim().slice(0, 2048) : null;
        if (url && !/^https?:\/\//i.test(url)) throw Object.assign(new Error('webhook.url precisa comecar com http:// ou https://'), { code: 'invalid_webhook' });
        inst.webhook = {
          url,
          enabled: !!url && (w.enabled !== false),
          // Lista vazia = todos os eventos.
          events: Array.isArray(w.events) ? w.events.map(String).slice(0, 32) : (inst.webhook?.events || []),
        };
      }
      salvar();
      return { ...inst };
    },

    /** Token novo: o antigo para de valer no proximo restart da instancia. */
    girarToken(nome) {
      const inst = instancias.find(x => x.name === nome);
      if (!inst) return null;
      inst.token = gerarToken();
      salvar();
      return { ...inst };
    },

    remover(nome) {
      const antes = instancias.length;
      instancias = instancias.filter(x => x.name !== nome);
      if (instancias.length === antes) return false;
      salvar();
      return true;
    },
  };
}
