import { describe, expect, it } from 'vitest';
import { analyzeAts, type AtsContent, type AtsProfile } from '../src/modules/ats/analyzer';

/**
 * El medidor de ATS. Es la pieza que decide si vale la pena postular, así que
 * los tests cubren lo que NO puede fallar: que no invente faltantes, que
 * castigue de verdad la maquetación de dos columnas, y que no se caiga con una
 * HV vacía.
 */

/** Oferta real (BairesDev, Junior Fullstack) usada como caso de referencia. */
const vacancy = {
  title: 'Junior Fullstack Developer',
  descriptionRaw: `At BairesDev, you will contribute to building modern web applications using React and Node.js technologies.
Develop responsive user interfaces using React and modern JavaScript features.
Build server-side applications using Node.js and Express.
Create and maintain RESTful APIs for web applications.
Basic knowledge of version control systems, preferably Git.
Familiarity with HTML5, CSS3, and modern JavaScript (ES6+).
Good understanding of basic algorithms and data structures.
Advanced level of English.`,
  enrichment: {
    skills: ['React', 'Node.js', 'Express', 'Git', 'HTML5', 'CSS3', 'JavaScript'],
    keyRequirements: [
      '1+ year of experience with React and Node.js development',
      'Good understanding of basic algorithms and data structures',
      'Basic knowledge of version control systems, preferably Git',
      'Advanced level of English',
    ],
    niceToHave: [],
  },
  strategyKeywords: ['React', 'Node.js', 'Express'],
};

const profile: AtsProfile = {
  name: 'Christian Henao',
  email: 'scristxyz@gmail.com',
  phone: '+57 320 571 1428',
  location: 'Pereira, Colombia',
  links: [{ type: 'github', url: 'https://github.com/Artag-Chris' }],
  languages: [{ language: 'Español', level: 'Nativo' }],
};

/** HV redactada para la vacante: cubre todo lo que el candidato sí tiene. */
const fullCv: AtsContent = {
  atsMode: true,
  headline: 'Full Stack Developer — React & Node.js',
  summary:
    'Full Stack Developer with experience building modern web applications using React and Node.js, and RESTful APIs with Express. Advanced English (B2). Strong grasp of algorithms and data structures.',
  skills: [
    'React',
    'Node.js',
    'Express',
    'JavaScript (ES6+)',
    'TypeScript',
    'HTML5',
    'CSS3',
    'Git',
    'REST APIs',
    'Algorithms and data structures',
  ],
  experience: [
    {
      role: 'Full Stack Developer',
      company: 'Finova',
      period: '2024 - Present',
      bullets: [
        'Built responsive interfaces with React and server-side APIs with Node.js and Express.',
        'Managed version control with Git and participated in code reviews.',
      ],
    },
  ],
  projects: [
    {
      name: 'Web platform',
      highlights: ['RESTful APIs on top of optimised data structures and algorithms.'],
    },
  ],
  education: [
    { institution: 'SENA', degree: 'Multimedia and Web Design', period: '2023 - Present' },
  ],
  softSkills: ['Teamwork'],
  keywords: [],
};

const analyze = (content: AtsContent, atsProfile: AtsProfile | null = profile) =>
  analyzeAts({ content, profile: atsProfile, vacancy });

describe('analyzeAts — cobertura de keywords', () => {
  it('una HV redactada para la vacante cubre las palabras clave y pasa', () => {
    const result = analyze(fullCv);

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.grade).toBe('PASS');
    expect(result.missingKeywords).toHaveLength(0);
  });

  it('no inventa faltantes: reconoce sinónimos y frases equivalentes', () => {
    const result = analyze(fullCv);
    // "Fullstack" del título se cubre con "Full Stack" y "nodejs" con "Node.js".
    expect(result.missingKeywords).not.toContain('Junior Fullstack Developer');
    expect(result.missingKeywords).not.toContain('Node.js');
  });

  it('lista como faltante lo que de verdad no está', () => {
    const noReact: AtsContent = {
      ...fullCv,
      // El titular también deja de mencionar React, si no la keyword sí estaría.
      headline: 'Backend Developer — Node.js & Express',
      summary: 'Backend developer with Node.js and Express.',
      skills: ['Node.js', 'Express', 'TypeScript'],
      experience: [],
      projects: [],
    };

    const result = analyze(noReact);

    expect(result.missingKeywords).toContain('React');
    expect(result.grade).not.toBe('PASS');
  });

  it('marca cobertura parcial cuando falta parte de un requisito compuesto', () => {
    const partial: AtsContent = {
      atsMode: true,
      headline: 'Developer',
      summary: 'I have experience with React.',
      skills: ['React'],
    };

    const result = analyze(partial);
    const node = result.keywords.find((k) => k.keyword === 'Node.js');

    // React está, Node.js no: la keyword del título queda parcial, no cubierta.
    expect(node?.state).toBe('missing');
    expect(result.missingKeywords.length).toBeGreaterThan(0);
  });

  it('detecta skills del texto crudo que la IA no marcó', () => {
    // "Express" y "Git" no están en strategyKeywords ni en keyRequirements.
    const result = analyze(fullCv);
    expect(result.keywords.map((k) => k.keyword)).toContain('Git');
    expect(result.keywords.map((k) => k.keyword)).toContain('Express');
  });
});

describe('analyzeAts — modo ATS vs maquetación heredada', () => {
  it('el MISMO contenido puntúa mejor con el Modo ATS encendido', () => {
    const legacy = analyze({ ...fullCv, atsMode: false });
    const ats = analyze({ ...fullCv, atsMode: true });

    expect(ats.score).toBeGreaterThan(legacy.score);
  });

  it('penaliza los encabezados no estándar y las dos columnas', () => {
    const legacy = analyze({ ...fullCv, atsMode: false });
    const structure = legacy.breakdown.find((b) => b.id === 'structure');
    const order = legacy.breakdown.find((b) => b.id === 'structure');

    expect(structure?.score).toBeLessThan(100);
    expect(legacy.warnings.join(' ')).toMatch(/dos columnas/i);
    expect(legacy.warnings.join(' ')).toMatch(/WORK EXPERIENCE/);
    expect(order).toBeDefined();
  });

  it('en Modo ATS la estructura es perfecta y las advertencias desaparecen', () => {
    const ats = analyze({ ...fullCv, atsMode: true });
    const structure = ats.breakdown.find((b) => b.id === 'structure');

    expect(structure?.score).toBe(100);
    expect(ats.warnings.join(' ')).not.toMatch(/dos columnas/i);
  });

  it('el contacto puntúa menos cuando el email va en mayúsculas con prefijo CEL:', () => {
    const legacy = analyze({ ...fullCv, atsMode: false });
    const ats = analyze({ ...fullCv, atsMode: true });
    const legacyContact = legacy.breakdown.find((b) => b.id === 'contact')?.score ?? 0;
    const atsContact = ats.breakdown.find((b) => b.id === 'contact')?.score ?? 0;

    expect(atsContact).toBeGreaterThan(legacyContact);
    expect(legacy.warnings.join(' ')).toMatch(/MAYÚSCULAS/);
    expect(legacy.warnings.join(' ')).toMatch(/CEL:/);
  });
});

describe('analyzeAts — bordes', () => {
  it('una HV vacía no rompe y saca un score bajo', () => {
    const result = analyze({ atsMode: true });

    expect(result.score).toBeLessThan(50);
    expect(result.grade).toBe('FAIL');
    expect(Array.isArray(result.missingKeywords)).toBe(true);
  });

  it('sin perfil no explota y avisa de la falta de email', () => {
    const result = analyze(fullCv, null);
    expect(result.warnings.join(' ')).toMatch(/email/i);
  });

  it('marca los emojis que el PDF descarta', () => {
    const withEmoji = analyze({ ...fullCv, summary: `${fullCv.summary} 🚀✅` });
    expect(withEmoji.warnings.join(' ')).toMatch(/caracteres que el PDF descarta/i);
  });

  it('el score del desglose se pondera con los pesos declarados', () => {
    const result = analyze(fullCv);
    const weights = result.breakdown.reduce((sum, b) => sum + b.weight, 0);
    expect(weights).toBeCloseTo(1, 5);

    const expected = Math.round(
      result.breakdown.reduce((sum, b) => sum + b.score * b.weight, 0),
    );
    expect(result.score).toBe(expected);
  });
});
