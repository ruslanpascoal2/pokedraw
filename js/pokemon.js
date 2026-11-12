// Dados dos Pokémon (1–151) vindos da PokeAPI em tempo de execução

export const MAX_POKEMON = 151;

const CACHE_KEY = 'pokedraw.names.v1';
let namesPromise = null;

export function artworkUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function prettify(name) {
  const special = { 'nidoran-f': 'Nidoran ♀', 'nidoran-m': 'Nidoran ♂', 'mr-mime': 'Mr. Mime', farfetchd: "Farfetch'd" };
  if (special[name]) return special[name];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function loadNames() {
  if (namesPromise) return namesPromise;
  namesPromise = (async () => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (Array.isArray(cached) && cached.length === MAX_POKEMON) return cached;
    } catch {}
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon?limit=${MAX_POKEMON}`);
      const json = await res.json();
      const names = json.results.map((r) => prettify(r.name));
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(names));
      } catch {}
      return names;
    } catch {
      return null;
    }
  })();
  return namesPromise;
}

export async function pokemonName(id) {
  const names = await loadNames();
  return names?.[id - 1] || `Pokémon #${String(id).padStart(3, '0')}`;
}

export function randomPokemonId(exclude) {
  let id;
  do {
    id = 1 + Math.floor(Math.random() * MAX_POKEMON);
  } while (id === exclude);
  return id;
}

export function preload(id) {
  const img = new Image();
  img.src = artworkUrl(id);
  return img;
}
