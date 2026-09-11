/**
 * Normalización de texto para el medidor de ATS.
 *
 * No existía nada así en `common/` (solo había `cleanDescription`, que quita
 * HTML, y el tokenizador de los mock embeddings, que conserva acentos). Un ATS
 * compara sin distinguir acentos ni mayúsculas, así que acá se baja a minúsculas
 * y se quitan los diacríticos.
 */

/**
 * Forma canónica para comparar. Conserva los caracteres que son significativos
 * en tecnología (`.` de `node.js`, `/` de `ci/cd`, `+` de `c++`, `#` de `c#`) y
 * convierte el resto de la puntuación en espacio.
 */
export function normalizeForAts(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#/.\s-]/g, ' ')
    .split(/\s+/)
    // Se recortan los separadores de los BORDES ("express." → "express"), pero
    // no `+` ni `#`: si no, `c++` quedaría `c` y `c#` quedaría `c`.
    .map((token) => token.replace(/^[./-]+|[./-]+$/g, ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Variante "compacta": quita los separadores internos. Sirve para que
 * `node.js`, `node-js` y `nodejs` colapsen al mismo término.
 */
export function compactToken(token: string): string {
  return token.replace(/[./\-_]/g, '');
}

/** Tokens sueltos, conservando `+`, `#`, `.` y `/` dentro de la palabra. */
export function tokenize(input: unknown): string[] {
  const normalized = normalizeForAts(input);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

/**
 * Palabras vacías y **palabras genéricas de requisito**. Las segundas son
 * clave: en "experiencia con React y Node.js" lo que importa es React y Node,
 * no "experiencia" (si no, cualquier HV "cubriría" cualquier requisito).
 */
const STOPWORDS = new Set([
  // Español
  'a', 'al', 'algo', 'como', 'con', 'de', 'del', 'el', 'ella', 'ellos', 'en', 'es', 'esa', 'ese',
  'esta', 'este', 'esto', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'muy', 'no', 'o', 'os',
  'para', 'pero', 'por', 'que', 'se', 'sin', 'su', 'sus', 'un', 'una', 'uno', 'y', 'ya', 'nos',
  // Inglés
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on',
  'or', 'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with', 'you', 'your', 'we', 'our',
  // Genéricas de requisito (no son tecnología)
  'experiencia', 'experience', 'conocimiento', 'conocimientos', 'knowledge', 'dominio', 'manejo',
  'habilidad', 'habilidades', 'skill', 'skills', 'nivel', 'level', 'anos', 'year', 'years',
  'deseable', 'nice', 'have', 'plus', 'requisito', 'requisitos', 'requirement', 'requirements',
  // OJO: 'ingles'/'english' NO van acá a propósito. "Advanced level of English" es un
  // requisito duro frecuente y su único token con carga semántica es el idioma.
  'avanzado', 'advanced', 'basico', 'basic', 'intermedio', 'intermediate',
  'trabajo', 'work', 'equipo', 'team', 'proyecto', 'project', 'bueno', 'good', 'familiaridad',
  'familiarity', 'entendimiento', 'understanding', 'capacidad', 'ability', 'solida', 'solid',
  // Seniority: cualifican al rol, no son una tecnología que un ATS busque.
  'junior', 'jr', 'senior', 'sr', 'semi', 'ssr', 'trainee', 'intern', 'practicante', 'pasantia',
  // Relleno de los enunciados de requisito ("basic knowledge of version control systems").
  'development', 'desarrollo', 'version', 'versionamiento', 'control', 'system', 'systems',
  'sistema', 'sistemas', 'preferably', 'preferiblemente', 'entorno', 'environment', 'entornos',
  'basico', 'basic', 'solido', 'strong', 'uso', 'use', 'manejo', 'gestion', 'management',
]);

const isStopword = (token: string): boolean =>
  STOPWORDS.has(token) || STOPWORDS.has(compactToken(token));

/** Tokens con carga semántica: sin vacías, sin números y sin letras sueltas. */
export function significantTokens(input: unknown): string[] {
  return tokenize(input).filter(
    (token) => token.length > 1 && !isStopword(token) && /[a-z]/.test(token),
  );
}
