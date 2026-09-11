/**
 * Grupos de alias para no castigar como "faltante" una keyword que en realidad
 * sí está escrita de otra forma (`Node.js` vs `nodejs`, `Postgres` vs
 * `PostgreSQL`). Deliberadamente corto y explícito: sin adivinar.
 */
const SYNONYM_GROUPS: string[][] = [
  ['node', 'nodejs', 'node.js'],
  ['js', 'javascript'],
  ['ts', 'typescript'],
  ['postgres', 'postgresql'],
  ['react', 'reactjs', 'react.js'],
  ['next', 'nextjs', 'next.js'],
  ['nest', 'nestjs', 'nest.js'],
  ['vue', 'vuejs', 'vue.js'],
  ['mongo', 'mongodb'],
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud'],
  ['k8s', 'kubernetes'],
  ['rest', 'restful', 'rest api', 'rest apis', 'api rest'],
  ['ci/cd', 'cicd', 'integracion continua', 'continuous integration'],
  ['ingles', 'english'],
  ['espanol', 'spanish'],
  ['html5', 'html'],
  ['css3', 'css'],
  ['es6', 'ecmascript', 'javascript es6'],
  ['llm', 'llms', 'large language model', 'large language models'],
  ['ia', 'ai', 'inteligencia artificial', 'artificial intelligence'],
  ['mensajeria', 'messaging', 'message queue', 'colas de mensajes'],
  ['git', 'version control', 'control de versiones'],
  ['algoritmos', 'algorithms', 'estructuras de datos', 'data structures'],
  ['webhooks', 'webhook'],
  ['microservicios', 'microservices'],
  ['frontend', 'front end', 'front-end'],
  ['backend', 'back end', 'back-end'],
  ['fullstack', 'full stack', 'full-stack'],
];

/**
 * Índice término→grupo. Se indexa tanto el término normalizado como su variante
 * compacta (sin separadores) para que `.` y `/` no rompan la equivalencia.
 */
const GROUP_BY_TERM = new Map<string, number>();
SYNONYM_GROUPS.forEach((group, index) => {
  for (const term of group) {
    GROUP_BY_TERM.set(term, index);
    GROUP_BY_TERM.set(term.replace(/[./\-_\s]/g, ''), index);
  }
});

/** Grupo de equivalencia de un token, o `null` si no tiene alias conocido. */
export function synonymGroup(token: string): number | null {
  return GROUP_BY_TERM.get(token) ?? GROUP_BY_TERM.get(token.replace(/[./\-_\s]/g, '')) ?? null;
}

/**
 * Todas las formas conocidas de un término (incluido él mismo). Permite que una
 * keyword multi-palabra se busque también por sus alias: `fullstack` encuentra
 * `full stack`, `ci/cd` encuentra `continuous integration`.
 */
export function synonymVariants(term: string): string[] {
  const group = synonymGroup(term);
  if (group === null) return [term];
  return SYNONYM_GROUPS[group];
}

/**
 * ¿El token de la vacante está representado en la HV? Compara exacto y, si
 * ambos tienen grupo, compara por grupo (así `node` cubre a `nodejs`).
 */
export function tokenMatches(needle: string, hay: string): boolean {
  if (needle === hay) return true;
  const compactNeedle = needle.replace(/[./\-_\s]/g, '');
  const compactHay = hay.replace(/[./\-_\s]/g, '');
  if (compactNeedle && compactNeedle === compactHay) return true;
  const needleGroup = synonymGroup(needle);
  return needleGroup !== null && needleGroup === synonymGroup(hay);
}
