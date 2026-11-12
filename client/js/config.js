// URL do servidor multiplayer.
// - Se a página for servida pelo próprio servidor (localhost ou Render), usa a mesma origem.
// - No GitHub Pages, usa DEPLOYED_SERVER.
// - Dá para sobrescrever com ?server=https://meu-servidor (fica salvo no navegador).

export const DEPLOYED_SERVER = 'https://pokedraw-server.onrender.com';

function resolveServer() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('server');
  try {
    if (fromQuery) localStorage.setItem('pokedraw.server', fromQuery);
    const saved = localStorage.getItem('pokedraw.server');
    if (saved) return saved;
  } catch {}
  if (location.hostname.endsWith('github.io') || location.protocol === 'file:') return DEPLOYED_SERVER;
  return location.origin;
}

export const SERVER_URL = resolveServer();
