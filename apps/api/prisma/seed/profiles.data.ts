// Perfil canónico consolidado de Christian_Henao_*.md.
// Los 3 markdown se contradicen en algunos ratings (ej. Express 5 vs 4,
// Nginx 3 vs 4, Prisma 5 vs 4, Git 5 vs 4). Esta es la consolidación manual:
// se tomó como base Christian_Henao_Proyectos_y_Skills.md (más reciente y
// detallado) y se moderaron los valores donde el formato era auto-evaluación
// alta (provenance queda como "curated" — el seed ES la fuente de verdad).

export interface SkillSeed {
  category: string;
  name: string;
  rating: number; // 1-5
  knowledge?: string;
}

export interface ProfileSeed {
  name: string;
  headline: string[];
  summary: string;
  email: string;
  phone: string;
  location: string;
  languages: { language: string; level: string }[];
  softSkills: string[];
  links: { type: string; url: string; isPrimary: boolean }[];
  experiences: {
    role: string;
    company: string;
    periodStart: string;
    periodEnd?: string;
    isCurrent?: boolean;
    bullets: string[];
  }[];
  education: {
    institution: string;
    degree: string;
    periodStart: string;
    periodEnd?: string;
  }[];
  projects: {
    name: string;
    summary: string;
    stack: string[];
    repositoryUrl?: string;
    websiteUrl?: string;
    visibility: string;
    highlights: string[];
  }[];
  skills: SkillSeed[];
}

export const profileSeed: ProfileSeed = {
  name: 'Christian Henao',
  headline: ['AI Engineer', 'Team Leader', 'Full Stack Developer'],
  summary: `AI Engineer y Team Leader con base sólida en desarrollo backend de sistemas distribuidos, especializado en aplicaciones potenciadas por LLMs, arquitecturas de agentes y pipelines de IA en producción. Lidero un equipo de 4 desarrolladores: distribución de tareas, definición de prioridades, code reviews y garantía de entregas robustas.

Experiencia transferible en microservicios, comunicación event-driven (NATS, RabbitMQ, WebSockets, webhooks), orquestación con Kubernetes e integraciones con APIs de terceros — la base para desplegar sistemas con modelos de lenguaje, tool use y workflows agénticos confiables.

Usuario avanzado de Claude Code y del ecosistema Anthropic; construyo mis proyectos con desarrollo asistido por IA como práctica diaria, con experiencia hands-on en prompt engineering aplicado, diseño de workflows con agentes y ciclo human-in-the-loop. Combino disciplina de ingeniería de software (seguridad, escalabilidad, patrones) con el rigor de llevar LLMs a producción: control de costos, latencia, observabilidad y sistemas confiables. Actualmente profundizando en RAG, frameworks de agentes, fine-tuning y MLOps.`,
  email: 'scristxyz@gmail.com',
  phone: '+57 320 571 1428',
  location: 'Pereira, Risaralda, Colombia',
  languages: [
    { language: 'Español', level: 'Nativo' },
    { language: 'Inglés', level: 'B2' },
  ],
  softSkills: [
    'Liderazgo técnico: team leader de 4 desarrolladores — tareas, mentoría, code reviews, desbloqueo técnico',
    'Resolución de problemas complejos',
    'Adaptabilidad y aprendizaje rápido de tecnologías emergentes',
    'Trabajo en equipo y comunicación con devs, diseñadores y clientes',
    'Pensamiento analítico para estructurar sistemas y arquitecturas',
    'Gestión del tiempo en múltiples proyectos con deadlines en paralelo',
    'Proactividad en mejora y optimización continua',
  ],
  links: [
    { type: 'email', url: 'mailto:scristxyz@gmail.com', isPrimary: true },
    { type: 'phone', url: 'tel:+573205711428', isPrimary: true },
    { type: 'github', url: 'https://github.com/Artag-Chris', isPrimary: true },
    { type: 'website', url: 'https://www.artagdev.com.co/', isPrimary: false },
  ],
  experiences: [
    {
      role: 'Team Leader & Full Stack Developer',
      company: 'Finova SAS',
      periodStart: '2024',
      periodEnd: 'Presente',
      isCurrent: true,
      bullets: [
        'Lidero un equipo de 4 desarrolladores: distribución y priorización de tareas, definición técnica, code reviews y garantía de entregas.',
        'Coordino el ciclo completo: planeación, ejecución y desbloqueo del equipo en escenarios técnicos complejos.',
        'Construyo y mantengo sistemas backend y frontend en producción para servicios financieros, con foco en seguridad, integraciones bancarias y arquitecturas escalables.',
        'Introduje y consolidé herramientas de desarrollo asistido por IA (Claude Code, LLMs) en el flujo del equipo, acelerando iteraciones con calidad y revisiones humanas.',
      ],
    },
    {
      role: 'Software Engineer Freelance',
      company: 'Independiente',
      periodStart: '2022',
      periodEnd: '2024',
      bullets: [
        'Desarrollo end-to-end de plataformas para múltiples clientes: pasarelas de pago, APIs de mensajería, e-commerce y exploración de microservicios.',
      ],
    },
  ],
  education: [
    {
      institution: 'SENA',
      degree: 'Diseño Multimedia y Web (Tecnólogo)',
      periodStart: '2023',
      periodEnd: 'Presente',
    },
    {
      institution: 'Universidad Autónoma de Bucaramanga',
      degree: 'Programación con énfasis en aplicaciones web',
      periodStart: '2021',
      periodEnd: '2022',
    },
  ],
  projects: [
    {
      name: 'Atiende — Agente conversacional de IA para WhatsApp Business',
      summary:
        'Arquitecto y líder de desarrollo de un agente de IA conversacional para WhatsApp de PYMEs latinoamericanas. Arquitectura hexagonal estricta (ports & adapters), cache multinivel (prompt caching Anthropic, semántico en pgvector, exacto en Redis), feature flags por módulo, pipeline asíncrono con BullMQ + Redis y RAG semántico sobre catálogos con pgvector.',
      stack: [
        'TypeScript',
        'NestJS 11',
        'PostgreSQL 16 + pgvector',
        'Prisma 6',
        'Redis 7',
        'BullMQ',
        'Anthropic Claude API',
        'OpenAI Embeddings',
        'Meta WhatsApp Business API',
        'Docker',
      ],
      repositoryUrl: 'https://github.com/Artag-Chris/atiende',
      visibility: 'public',
      highlights: [
        'Diseñé el pipeline de agentes con tool use, presupuesto USD por conversación y circuit breaker multi-proveedor LLM.',
        'Implementé cache semántico + exacto proyectando ~30% de ahorro en costo LLM por conversación.',
        'Configuré subagentes custom (db-migrations, prompt-reviewer), MCP servers y flujo spec-driven.',
      ],
    },
    {
      name: 'Payment Gateway Platform — integración financiera full-stack',
      summary:
        'Lideré el desarrollo end-to-end de una pasarela de pagos para el sector financiero colombiano (backend API + frontend). Webhooks de estado en tiempo real, cron jobs de reconciliación contra APIs bancarias e integración con Goupagos AvVillas. Patrón Adapter para desacoplar proveedores bancarios — reutilizado después para abstraer proveedores LLM.',
      stack: [
        'Node.js',
        'TypeScript',
        'NestJS',
        'React',
        'PostgreSQL',
        'Prisma',
        'Webhooks',
        'Cron Jobs',
        'JWT',
        'Docker',
      ],
      visibility: 'proprietary',
      highlights: [
        'Diseñé el flujo completo de pago desde checkout hasta reconciliación con la API bancaria.',
        'Apliqué Adapter y Singleton para integración bancaria y manejo de conexiones.',
      ],
    },
    {
      name: 'Microservices — plataforma de mensajería y automatización multicanal',
      summary:
        'Arquitecto y líder de una plataforma de mensajería multicanal con 12+ microservicios independientes (WhatsApp, Slack, Notion, Instagram, TikTok, Messenger, Email), orquestados con RabbitMQ topic exchanges y un único gateway HTTP público. Sync service con read model CQRS en MongoDB, scheduler con BullMQ, y scraping con Puppeteer.',
      stack: [
        'NestJS 10',
        'TypeScript',
        'RabbitMQ',
        'PostgreSQL',
        'MongoDB',
        'Prisma',
        'Redis',
        'BullMQ',
        'Kubernetes',
        'AWS',
        'Puppeteer',
      ],
      repositoryUrl: 'https://github.com/artag-services/Microservices',
      visibility: 'public',
      highlights: [
        'Regla estricta: los servicios nunca se comunican directo — siempre por RabbitMQ; el gateway es el único punto HTTP público.',
        'Todo write publica eventos data.* consumidos por el sync service para mantener el read model desnormalizado.',
      ],
    },
    {
      name: 'Artag Dev — portafolio personal y presencia digital',
      summary:
        'Portafolio full-stack con Next.js 15 App Router server-first, design system propio sobre shadcn/ui + Tailwind, analítica multicanal (GA4, Meta Pixel, TikTok Pixel) con CSP auto-generada, y widget de chat IA con n8n.',
      stack: [
        'Next.js 15',
        'React 19',
        'TypeScript',
        'Tailwind CSS',
        'Framer Motion',
        'GSAP',
        'Vercel',
        'n8n',
      ],
      websiteUrl: 'https://www.artagdev.com.co/',
      repositoryUrl: 'https://github.com/Artag-Chris',
      visibility: 'public',
      highlights: [
        'Contenido versionado en src/data, sin CMS.',
        'JSON-LD (Organization, Person, FAQ) para buscadores y crawlers de IA.',
      ],
    },
  ],
  // Consolidación canónica de ratings (1-5). Fuente: Proyectos_y_Skills + Skills_Formato.
  skills: [
    // ── IA & LLMs ─────────────────────────────────────────────
    { category: 'IA & LLMs', name: 'Anthropic Claude API', rating: 4, knowledge: 'Tool use, prompt caching (cache_control), streaming, structured outputs, multi-turn. Opus/Sonnet/Haiku.' },
    { category: 'IA & LLMs', name: 'OpenAI API', rating: 3, knowledge: 'Embeddings text-embedding-3-small para RAG y fallback de LLM.' },
    { category: 'IA & LLMs', name: 'Claude Code', rating: 4, knowledge: 'CLI, hooks, slash commands, MCP servers, subagentes custom (db-migrations, prompt-reviewer).' },
    { category: 'IA & LLMs', name: 'Tool use / Function calling', rating: 4, knowledge: 'Loop tool_use → tool_result con validación Zod.' },
    { category: 'IA & LLMs', name: 'Prompt engineering', rating: 4, knowledge: 'System prompts, few-shot, chain-of-thought, structured prompting.' },
    { category: 'IA & LLMs', name: 'RAG', rating: 3, knowledge: 'pgvector + búsqueda coseno, chunking con overlap, embeddings.' },
    { category: 'IA & LLMs', name: 'Prompt caching', rating: 4, knowledge: 'cache_control ephemeral, caché por niveles con hit rate tracking.' },
    { category: 'IA & LLMs', name: 'Streaming (LLM)', rating: 3, knowledge: 'Base en WebSockets bidireccionales; streaming planificado en Atiende.' },
    { category: 'IA & LLMs', name: 'Agent architecture', rating: 4, knowledge: 'Tool use loop, presupuesto USD/conversación, feature flags por tool.' },
    // ── Backend ───────────────────────────────────────────────
    { category: 'Backend', name: 'TypeScript', rating: 5, knowledge: 'Lenguaje principal; strict mode, discriminated unions, Zod.' },
    { category: 'Backend', name: 'Node.js', rating: 5, knowledge: 'Runtime principal; streams, event loop, graceful shutdown.' },
    { category: 'Backend', name: 'NestJS', rating: 4, knowledge: 'Módulos dinámicos, DI con tokens, guards/interceptors, feature-flag module loading.' },
    { category: 'Backend', name: 'Express', rating: 4, knowledge: 'APIs REST, middleware, verificación de webhooks.' },
    { category: 'Backend', name: 'REST API Design', rating: 4, knowledge: 'Status codes, paginación, rate limiting, webhooks con retry.' },
    { category: 'Backend', name: 'WebSockets', rating: 3, knowledge: 'Comunicación bidireccional, identificación de clientes.' },
    { category: 'Backend', name: 'Webhooks', rating: 4, knowledge: 'Verificación HMAC (Meta), callbacks de estado, idempotencia.' },
    { category: 'Backend', name: 'Cron jobs / Job scheduling', rating: 4, knowledge: 'BullMQ repeatable, backoff exponencial, concurrencia por cola.' },
    { category: 'Backend', name: 'Hexagonal Architecture / Adapter', rating: 4, knowledge: 'Atiende full hexagonal: core puro + adapters intercambiables.' },
    { category: 'Backend', name: 'Event-driven architecture', rating: 4, knowledge: 'RabbitMQ topic exchanges (12+ microservicios), BullMQ (Atiende).' },
    { category: 'Backend', name: 'Authentication (JWT, OAuth)', rating: 4, knowledge: 'JWT + refresh, OAuth Google/Facebook, RBAC.' },
    { category: 'Backend', name: 'Zod', rating: 4, knowledge: 'Validación de env fail-fast y schemas de entrada.' },
    { category: 'Backend', name: 'Rust', rating: 3, knowledge: 'Scraping con tokio/reqwest/scraper, streams Redis, concurrencia.' },
    // ── Frontend ──────────────────────────────────────────────
    { category: 'Frontend', name: 'Next.js', rating: 4, knowledge: 'App Router, server-first, SSG, code splitting.' },
    { category: 'Frontend', name: 'React', rating: 4, knowledge: 'Functional components, hooks, interactive islands.' },
    { category: 'Frontend', name: 'Zustand', rating: 3, knowledge: 'Estado global con slices.' },
    { category: 'Frontend', name: 'Tailwind CSS', rating: 4, knowledge: 'Design system propio sobre Tailwind.' },
    // ── Bases de datos ────────────────────────────────────────
    { category: 'Databases', name: 'PostgreSQL', rating: 4, knowledge: 'Modelado relacional, pgvector para búsqueda semántica.' },
    { category: 'Databases', name: 'MySQL', rating: 4, knowledge: 'Stored procedures, optimización de queries.' },
    { category: 'Databases', name: 'Prisma ORM', rating: 4, knowledge: 'ORM principal; migraciones, Studio.' },
    { category: 'Databases', name: 'Redis', rating: 3, knowledge: 'Backend BullMQ, cache exacto, key prefix por entorno.' },
    { category: 'Databases', name: 'pgvector', rating: 3, knowledge: 'Similitud coseno, consultas híbridas.' },
    { category: 'Databases', name: 'SQLite', rating: 3, knowledge: 'Proyectos freelance.' },
    { category: 'Databases', name: 'MongoDB', rating: 2, knowledge: 'Read model CQRS.' },
    // ── Infra & Cloud ─────────────────────────────────────────
    { category: 'Infra & Cloud', name: 'Docker', rating: 4, knowledge: 'Dockerfiles multi-stage, docker-compose, healthchecks.' },
    { category: 'Infra & Cloud', name: 'Docker Compose', rating: 4, knowledge: 'Orquestación local multi-servicio.' },
    { category: 'Infra & Cloud', name: 'Kubernetes', rating: 3, knowledge: 'Orquestación de contenedores, deployment de microservicios.' },
    { category: 'Infra & Cloud', name: 'AWS (EC2)', rating: 3, knowledge: 'Deploy de microservicios en EC2, security groups.' },
    { category: 'Infra & Cloud', name: 'RabbitMQ', rating: 4, knowledge: 'Topic exchanges como backbone de 12+ microservicios.' },
    { category: 'Infra & Cloud', name: 'Nginx', rating: 3, knowledge: 'Reverse proxy, SSL, load balancing.' },
    { category: 'Infra & Cloud', name: 'Vercel', rating: 3, knowledge: 'Deploy con Speed Insights.' },
    // ── Integraciones & APIs externas ─────────────────────────
    { category: 'Integrations', name: 'Meta WhatsApp Business API', rating: 4, knowledge: 'Webhooks con verificación HMAC, API de mensajería.' },
    { category: 'Integrations', name: 'Stripe', rating: 3, knowledge: 'Pasarela en ecosistema microservicios.' },
    { category: 'Integrations', name: 'Cloudinary', rating: 3, knowledge: 'Transformaciones dinámicas de imágenes.' },
    { category: 'Integrations', name: 'Integración bancaria (AvVillas)', rating: 3, knowledge: 'Goupagos AvVillas, reconciliación transaccional.' },
    // ── Mobile ────────────────────────────────────────────────
    { category: 'Mobile', name: 'Flutter', rating: 2, knowledge: 'UIs móviles responsivas.' },
    { category: 'Mobile', name: 'React Native', rating: 2, knowledge: 'Desarrollo móvil cross-platform.' },
    // ── Dev tools & otros ─────────────────────────────────────
    { category: 'Dev Tools', name: 'Git / GitHub', rating: 4, knowledge: 'Branching, PRs con code review, conventional commits.' },
    { category: 'Dev Tools', name: 'Conventional Commits', rating: 4, knowledge: 'Estándar en Atiende.' },
    { category: 'Dev Tools', name: 'ESLint + Prettier', rating: 4, knowledge: 'Calidad de código consistente.' },
    { category: 'Dev Tools', name: 'Vitest', rating: 3, knowledge: 'Unit tests, coverage.' },
    { category: 'Dev Tools', name: 'JavaScript (vanilla)', rating: 4, knowledge: 'Async/await, Fetch API, manipulación DOM.' },
    { category: 'Dev Tools', name: 'HTML5 / CSS3', rating: 4, knowledge: 'Markup semántico, responsive, accesibilidad.' },
    { category: 'Dev Tools', name: 'Python', rating: 2, knowledge: 'Scripts de scraping, asyncio, Flask.' },
    { category: 'Dev Tools', name: 'GitHub Actions', rating: 3, knowledge: 'CI en PRs, deployment workflows.' },
    // ── Metodologías ──────────────────────────────────────────
    { category: 'Methodologies', name: 'Scrum', rating: 4, knowledge: 'Sprint planning, dailies, coordinación de equipo de 4.' },
    { category: 'Methodologies', name: 'Waterfall', rating: 3, knowledge: 'Fases de requerimientos, hitos y aprobaciones.' },
  ],
};
